// Inventory module — the sole writer of Variant.onHand/held (design.md D2).
//
// D3: every stock change is a conditional UPDATE — `0 rows affected` means
// the WHERE clause's availability check failed, so we throw and (when
// called inside a caller-provided transaction) the whole transaction rolls
// back. This is the ONLY concurrency primitive in the app: Postgres
// serializes concurrent UPDATEs targeting the same row under the default
// READ COMMITTED isolation level, so two buyers racing for the last unit
// can never both succeed — the loser's WHERE clause is re-evaluated against
// the already-updated row and fails.
//
// Backs specs/inventory-stock/spec.md:
//   - "Reservations Decrement Available Stock Without Marking Sold"
//   - "Auto-Release Applies Only to Reserved-Unpaid Stock" (hold() is the
//     only writer of `held` at checkout time; release()/commitPaid() land
//     in later phases)
//
// `hold()` (Phase 4), `commitPaid()`/`release()` (Phase 5, tasks 5.4/5.5),
// and `sellInStore()`/`adjust()` (Phase 7, tasks 7.7/7.8) are all
// implemented here — the admin console's in-store sale and manual
// reconciliation actions call these, never mutate Variant rows directly.

import { StockMovementReason, type PrismaClient } from "@/generated/prisma/client";

export class OutOfStockError extends Error {
  constructor(
    public readonly variantId: string,
    public readonly qty: number,
  ) {
    super(
      `Variant ${variantId} does not have ${qty} unit(s) available (conditional UPDATE matched 0 rows).`,
    );
    this.name = "OutOfStockError";
  }
}

// tasks.md 7.8 — distinct from OutOfStockError: adjust() failures aren't
// "not enough availability for a sale", they're "this correction would
// violate the onHand>=held / onHand>=0 invariants" (a data-entry mistake by
// staff, e.g. adjusting -5 when only 2 units are on hand).
export class InvalidStockAdjustmentError extends Error {
  constructor(
    public readonly variantId: string,
    public readonly delta: number,
  ) {
    super(
      `Adjustment of ${delta} on variant ${variantId} would violate onHand>=held or onHand>=0 (conditional UPDATE matched 0 rows).`,
    );
    this.name = "InvalidStockAdjustmentError";
  }
}

/**
 * Any Prisma client shape that can run a raw parameterized UPDATE — either
 * the top-level PrismaClient (autocommits the single statement) or the
 * `tx` callback param of `prisma.$transaction(async (tx) => ...)`, so a
 * caller can compose hold() with other writes (e.g. Order creation, task
 * 4.6) inside one all-or-nothing transaction.
 */
export type StockClient = Pick<PrismaClient, "$executeRaw"> & {
  stockMovement: Pick<PrismaClient["stockMovement"], "create">;
};

export interface HoldParams {
  variantId: string;
  qty: number;
  /** Order this hold is committed to, when known — recorded on the audit
   * ledger row. Undefined is valid (e.g. a hold attempted before the Order
   * row exists in the same transaction is not expected; callers should
   * create the Order first so this is always available in practice). */
  orderId?: string;
}

export interface ReleaseParams extends HoldParams {
  /** Audit ledger reason for this release. Defaults to RELEASE (rejected/
   * cancelled payment, tasks.md 5.5). The Phase 6 expiry sweep
   * (src/jobs/expire-reservations.ts) passes StockMovementReason.EXPIRE
   * instead, so the ledger can tell "buyer's payment was rejected" apart
   * from "hold window elapsed unattended" — both release the same `held`
   * counter via the identical conditional UPDATE below, only the recorded
   * reason differs. */
  reason?: StockMovementReason;
}

/**
 * D3's single concurrency primitive: `held += qty` WHERE there is enough
 * available stock (`onHand - held >= qty`). 0 rows affected ⇒ not enough
 * stock right now ⇒ throw OutOfStockError so the caller's transaction rolls
 * back (design.md Interfaces section — the exact SQL shape below mirrors
 * that section 1:1, run through Prisma's parameterized $executeRaw so the
 * values are never string-interpolated).
 */
export async function hold(client: StockClient, params: HoldParams): Promise<void> {
  const { variantId, qty, orderId } = params;
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new RangeError(`hold() qty must be a positive integer, got ${qty}`);
  }

  const affected = await client.$executeRaw`
    UPDATE "variants"
    SET held = held + ${qty}
    WHERE id = ${variantId} AND "onHand" - held >= ${qty}
  `;

  if (affected === 0) {
    throw new OutOfStockError(variantId, qty);
  }

  // Audit ledger (design.md: "StockMovement — Audit ledger for every
  // onHand/held mutation"). `delta` here tracks the `held` movement, not
  // onHand — onHand is untouched by a hold.
  await client.stockMovement.create({
    data: {
      variantId,
      delta: qty,
      reason: StockMovementReason.HOLD,
      orderId,
    },
  });
}

/**
 * tasks.md 5.4 — the Atomic Stock Decrement HARD RULE
 * (specs/payment-mercadopago "Atomic, Immediate Stock Decrement on
 * Confirmed Payment"): when a webhook confirms an `approved` payment,
 * `onHand` and `held` are decremented TOGETHER in one conditional UPDATE —
 * never as two separate statements (release-then-decrement) that could
 * interleave with a concurrent in-store sale or another webhook. This is
 * design.md's Interfaces section second SQL statement verbatim:
 *
 *   UPDATE "Variant" SET "onHand" = "onHand" - $2, held = held - $2
 *     WHERE id = $1 AND "onHand" >= $2 AND held >= $2;
 *
 * `0` rows affected ⇒ the invariant that a hold() always preceded this call
 * was violated (should not happen in practice — a bug or data corruption,
 * not a normal-flow "out of stock"), so it throws the same OutOfStockError
 * design.md documents for this row.
 */
export async function commitPaid(client: StockClient, params: HoldParams): Promise<void> {
  const { variantId, qty, orderId } = params;
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new RangeError(`commitPaid() qty must be a positive integer, got ${qty}`);
  }

  const affected = await client.$executeRaw`
    UPDATE "variants"
    SET "onHand" = "onHand" - ${qty}, held = held - ${qty}
    WHERE id = ${variantId} AND "onHand" >= ${qty} AND held >= ${qty}
  `;

  if (affected === 0) {
    throw new OutOfStockError(variantId, qty);
  }

  await client.stockMovement.create({
    data: {
      variantId,
      delta: -qty,
      reason: StockMovementReason.PAID,
      orderId,
    },
  });
}

/**
 * tasks.md 5.5 — rejected/cancelled payments (and, in Phase 6, the expiry
 * sweep) return held stock to availability WITHOUT touching `onHand`
 * (specs/payment-mercadopago "Payment rejected or cancelled": "the system
 * MUST NOT decrement stock"). `0` rows affected ⇒ trying to release more
 * than is currently held for this variant — also an invariant violation,
 * same OutOfStockError shape as the other conditional updates.
 */
export async function release(client: StockClient, params: ReleaseParams): Promise<void> {
  const { variantId, qty, orderId, reason = StockMovementReason.RELEASE } = params;
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new RangeError(`release() qty must be a positive integer, got ${qty}`);
  }

  const affected = await client.$executeRaw`
    UPDATE "variants"
    SET held = held - ${qty}
    WHERE id = ${variantId} AND held >= ${qty}
  `;

  if (affected === 0) {
    throw new OutOfStockError(variantId, qty);
  }

  await client.stockMovement.create({
    data: {
      variantId,
      delta: -qty,
      reason,
      orderId,
    },
  });
}

export interface SellInStoreParams {
  variantId: string;
  qty: number;
  /** AdminUser.id of the staff member who rang up the sale, for the audit
   * ledger — undefined is valid (not every caller has an authenticated
   * actor id readily available, e.g. tests). */
  actorId?: string;
}

/**
 * tasks.md 7.7 — an in-person ("Vender en local") sale, run from
 * /admin/caja. Design.md's Sequence — Stock & Reservation: "in-store sale →
 * onHand-=q via the same conditional UPDATE + StockMovement(reason=
 * IN_STORE_SALE)". Deliberately checks `"onHand" - held >= qty` — the SAME
 * availability condition hold() uses — so staff can never sell a unit that
 * is currently reserved-unpaid (online cash/transfer reservation) or
 * already sold-paid (which has already left onHand via commitPaid()); this
 * is the concrete mechanism behind the inventory-stock "Real-Time-Accurate
 * Stock View" HARD RULE (a webhook-confirmed payment's commitPaid() call
 * and this function race on the exact same row/condition, so whichever
 * commits first wins and the other's conditional UPDATE matches 0 rows).
 */
export async function sellInStore(client: StockClient, params: SellInStoreParams): Promise<void> {
  const { variantId, qty, actorId } = params;
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new RangeError(`sellInStore() qty must be a positive integer, got ${qty}`);
  }

  const affected = await client.$executeRaw`
    UPDATE "variants"
    SET "onHand" = "onHand" - ${qty}
    WHERE id = ${variantId} AND "onHand" - held >= ${qty}
  `;

  if (affected === 0) {
    throw new OutOfStockError(variantId, qty);
  }

  await client.stockMovement.create({
    data: {
      variantId,
      delta: -qty,
      reason: StockMovementReason.IN_STORE_SALE,
      actorId,
    },
  });
}

export interface AdjustParams {
  variantId: string;
  /** Signed correction to apply to onHand. Positive = restock/found units;
   * negative = damage/miscount correction. Never 0 — a no-op adjustment is
   * a caller bug, not a valid audit-ledger entry. */
  delta: number;
  actorId?: string;
}

/**
 * tasks.md 7.8 — manual admin reconciliation (specs/inventory-stock/spec.md
 * "Manual Admin Reconciliation": "the corrected value SHALL apply
 * immediately across storefront and admin views"). A single conditional
 * UPDATE handles BOTH signs of `delta` uniformly: `onHand + delta >= held
 * AND onHand + delta >= 0` is always true for a positive delta (onHand
 * already satisfies onHand>=held and onHand>=0, and adding a positive
 * number can't break either), and is exactly the guard a negative delta
 * needs — so this never needs an onHand upper bound and never lets onHand
 * drop below `held` or below zero, the same invariant hold()/commitPaid()/
 * release() protect.
 */
export async function adjust(client: StockClient, params: AdjustParams): Promise<void> {
  const { variantId, delta, actorId } = params;
  if (!Number.isInteger(delta) || delta === 0) {
    throw new RangeError(`adjust() delta must be a non-zero integer, got ${delta}`);
  }

  const affected = await client.$executeRaw`
    UPDATE "variants"
    SET "onHand" = "onHand" + ${delta}
    WHERE id = ${variantId} AND "onHand" + ${delta} >= held AND "onHand" + ${delta} >= 0
  `;

  if (affected === 0) {
    throw new InvalidStockAdjustmentError(variantId, delta);
  }

  await client.stockMovement.create({
    data: {
      variantId,
      delta,
      reason: StockMovementReason.ADJUSTMENT,
      actorId,
    },
  });
}
