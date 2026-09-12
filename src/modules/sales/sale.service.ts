// Sales module — in-person sale recording and voiding (control-de-caja).
//
// Backs specs/sales-revenue/spec.md "In-Person Sale Recording" and "Sale
// Voiding (Anular)", design.md D1/D2/D6 and diagrams (a)/(b), and
// openspec/changes/control-de-caja/tasks.md Phase 2/Phase 3.
//
// recordInStoreSale() composes the existing sellInStore() (stock.service.ts
// — unchanged, stock-only contract) with a Sale.create() in the SAME
// $transaction: a sale and its stock decrement always succeed or fail
// together, exactly like every other stock mutation in this codebase.

import type { PrismaClient, Sale } from "@/generated/prisma/client";
import { adjust, sellInStore } from "@/modules/inventory/stock.service";

export interface RecordInStoreSaleParams {
  variantId: string;
  qty: number;
  paymentMethod: "CASH" | "TRANSFER";
  actorId?: string;
}

/**
 * design.md diagram (a): resolves unitPrice as `variant.priceOverride ??
 * product.price` — the exact expression createPendingOrder() already uses
 * — then runs sellInStore() (onHand-=qty + StockMovement(IN_STORE_SALE))
 * and Sale.create() inside one $transaction. If sellInStore() throws
 * OutOfStockError (0 rows matched the conditional UPDATE), the whole
 * transaction rolls back and NO Sale row is left behind.
 */
export async function recordInStoreSale(
  prisma: PrismaClient,
  params: RecordInStoreSaleParams,
): Promise<Sale> {
  const { variantId, qty, paymentMethod, actorId } = params;

  const variant = await prisma.variant.findUniqueOrThrow({
    where: { id: variantId },
    include: { product: { select: { price: true } } },
  });
  const unitPrice = variant.priceOverride ?? variant.product.price;

  return prisma.$transaction(async (tx) => {
    await sellInStore(tx, { variantId, qty, actorId });

    return tx.sale.create({
      data: {
        variantId,
        qty,
        unitPrice,
        paymentMethod,
        actorId,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Sale Voiding ("Anular") — tasks.md Phase 3.
//
// Backs specs/sales-revenue/spec.md "Sale Voiding (Anular)" and design.md
// D2/diagram (b). See that diagram's doc comment for the full rationale:
// the atomic claim UPDATE below is the WHOLE concurrency guard (a positive
// restock can never violate onHand>=held/onHand>=0, so the protection must
// instead be a business window — same-caja-day, owner-confirmed — folded
// into the same claim).
// ---------------------------------------------------------------------------

export class SaleNotFoundError extends Error {
  constructor(public readonly saleId: string) {
    super(`Sale ${saleId} not found.`);
    this.name = "SaleNotFoundError";
  }
}

export class SaleAlreadyVoidedError extends Error {
  constructor(public readonly saleId: string) {
    super(`Sale ${saleId} has already been voided.`);
    this.name = "SaleAlreadyVoidedError";
  }
}

export class SaleVoidWindowClosedError extends Error {
  constructor(public readonly saleId: string) {
    super(
      `Sale ${saleId} was not sold today (same-caja-day window) and can no longer be voided — ` +
        "correct it via a manual stock Ajuste instead.",
    );
    this.name = "SaleVoidWindowClosedError";
  }
}

/** Argentina has had no DST since 2009 and the app is single-locale es-AR
 * (design.md D5) — a fixed UTC−3 offset is exact here too, mirroring
 * src/lib/report-day.ts's day-edge math (tasks.md 5.2) but taking an
 * instant rather than a `YYYY-MM-DD` string: voidSale() needs "the start of
 * TODAY, in Argentina, right now", not "resolve an arbitrary requested
 * date". Two small functions, same UTC−3 idea, deliberately not shared —
 * they answer different questions. */
const ARGENTINA_UTC_OFFSET_HOURS = 3;

function startOfArgentinaDay(now: Date): Date {
  const shifted = new Date(now.getTime() - ARGENTINA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      ARGENTINA_UTC_OFFSET_HOURS,
      0,
      0,
      0,
    ),
  );
}

export interface VoidSaleParams {
  saleId: string;
  actorId?: string;
}

/**
 * design.md diagram (b): one atomic claim UPDATE (`voidedAt IS NULL AND
 * soldAt >= startOfArgentinaDay(now)`) is the entire guard against
 * double-void AND the entire guard against voiding a stale sale. `0` rows
 * affected means one of those two conditions failed — re-reads the row
 * (still inside the same transaction, nothing committed yet) to classify
 * WHICH: missing -> SaleNotFoundError, already voided ->
 * SaleAlreadyVoidedError, too old -> SaleVoidWindowClosedError. On success,
 * restocks via the existing adjust() (+qty, StockMovementReason.ADJUSTMENT)
 * — the same conditional-update primitive every other stock mutation uses.
 */
export async function voidSale(prisma: PrismaClient, params: VoidSaleParams): Promise<Sale> {
  const { saleId, actorId } = params;
  const now = new Date();
  const startOfDay = startOfArgentinaDay(now);

  return prisma.$transaction(async (tx) => {
    const affected = await tx.$executeRaw`
      UPDATE "sales"
      SET "voidedAt" = ${now}, "voidedById" = ${actorId ?? null}
      WHERE id = ${saleId} AND "voidedAt" IS NULL AND "soldAt" >= ${startOfDay}
    `;

    if (affected === 0) {
      const existing = await tx.sale.findUnique({ where: { id: saleId } });
      if (!existing) {
        throw new SaleNotFoundError(saleId);
      }
      if (existing.voidedAt !== null) {
        throw new SaleAlreadyVoidedError(saleId);
      }
      throw new SaleVoidWindowClosedError(saleId);
    }

    const voided = await tx.sale.findUniqueOrThrow({ where: { id: saleId } });
    await adjust(tx, { variantId: voided.variantId, delta: voided.qty, actorId });
    return voided;
  });
}
