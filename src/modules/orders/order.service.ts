// Orders module — checkout order creation (design.md D1: business logic
// lives here, not in the route handler, so app/api/checkout/route.ts stays
// a thin HTTP adapter).
//
// Backs:
//   - specs/cart-checkout/spec.md "Stock Re-Validation at Submission"
//   - design.md D5 (short `held` hold at MP checkout submit, 30 min) and
//     the Sequence — Stock & Reservation diagram
//   - tasks.md 4.5 (re-validate stock, reject unavailable lines) and 4.6
//     (Order(PENDING_PAYMENT, expiresAt=+30min) + hold() per line, one tx)
//
// tasks.md 6.2/6.3 — the RESERVED (pickup cash/transfer) branch: `method ===
// "PICKUP_CASH"` creates Order(RESERVED) with `expiresAt` = closing time of
// the next open business day (design.md's "Sequence — Stock & Reservation":
// hold() is identical either way — a reservation is reserved-unpaid stock,
// not sold-paid, and onHand is only ever touched by commitPaid()/sellInStore
// later, at markPickedUp() for this path since there is no separate online
// payment step for cash-at-pickup).

import { randomUUID } from "node:crypto";
import {
  Prisma,
  type Order,
  type OrderItem,
  type OrderMethod,
  type OrderStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { nextOpenBusinessDayClose } from "@/lib/business-days";
import { getAvailableStock } from "@/modules/catalog/variant-availability";
import { commitPaid, hold, release } from "@/modules/inventory/stock.service";

export class EmptyCartError extends Error {
  constructor() {
    super("Cannot create an order with an empty cart.");
    this.name = "EmptyCartError";
  }
}

export class StockUnavailableError extends Error {
  constructor(public readonly variantIds: string[]) {
    super(
      `The following variant(s) no longer have enough stock available: ${variantIds.join(", ")}`,
    );
    this.name = "StockUnavailableError";
  }
}

/** D5: PENDING_PAYMENT orders hold stock for 30 minutes before the MP
 * checkout submission expires. */
const PENDING_PAYMENT_HOLD_MINUTES = 30;

/**
 * tasks.md 6.2/6.3 — the two checkout methods compute `expiresAt` and the
 * initial status very differently:
 *   - MP: PENDING_PAYMENT, +30min (D5) — unchanged from Phase 4.
 *   - PICKUP_CASH: RESERVED, closing time of the next open business day
 *     (design.md's Data Model Sketch), computed via business-days.ts from
 *     the live StoreHours + Holiday rows. Fetched OUTSIDE the write
 *     transaction below — both tables change extremely rarely (owner-only,
 *     via admin) and reading them transactionally would gain nothing while
 *     adding two extra statements to every reservation's transaction.
 */
async function computeInitialOrderState(
  prisma: PrismaClient,
  method: OrderMethod,
  now: Date,
): Promise<{ status: OrderStatus; expiresAt: Date }> {
  if (method === "MP") {
    return {
      status: "PENDING_PAYMENT",
      expiresAt: new Date(now.getTime() + PENDING_PAYMENT_HOLD_MINUTES * 60_000),
    };
  }

  const [storeHours, holidays] = await Promise.all([
    prisma.storeHours.findMany(),
    prisma.holiday.findMany(),
  ]);
  const expiresAt = nextOpenBusinessDayClose({
    now,
    storeHours,
    holidays: holidays.map((holiday) => holiday.date),
  });
  return { status: "RESERVED", expiresAt };
}

export interface CheckoutLine {
  variantId: string;
  qty: number;
}

export interface CreatePendingOrderInput {
  buyerName: string;
  phone: string;
  email: string;
  method: OrderMethod;
  items: CheckoutLine[];
}

export type PendingOrder = Order & { items: OrderItem[] };

function generatePublicCode(): string {
  // Human-shareable order reference for /pedido/[code] lookup (Phase 6) —
  // short, unique enough for MVP volume, backed by the DB's UNIQUE
  // constraint on Order.publicCode as the actual guarantee.
  return `DOM-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/**
 * Creates a guest checkout order in PENDING_PAYMENT with a +30min
 * expiresAt, holding every line's stock inside the SAME transaction as the
 * Order/OrderItem rows (design.md D5, D3): if any line's hold() fails, the
 * whole transaction — order, items, and every hold attempted so far — rolls
 * back. Nothing is left half-committed.
 *
 * Before opening that transaction, current availability is re-validated for
 * every line (specs/cart-checkout "Stock Re-Validation at Submission") so
 * the customer gets ONE response listing every now-unavailable line rather
 * than a single first-failure. This pre-check is a UX optimization, not the
 * safety guarantee — the transactional hold() below is the actual source of
 * truth for concurrent-submission races (see order.service.test.ts's race
 * test).
 */
export async function createPendingOrder(
  prisma: PrismaClient,
  input: CreatePendingOrderInput,
): Promise<PendingOrder> {
  if (input.items.length === 0) {
    throw new EmptyCartError();
  }

  const variantIds = input.items.map((line) => line.variantId);
  const variants = await prisma.variant.findMany({
    where: { id: { in: variantIds } },
    include: { product: { select: { price: true } } },
  });
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));

  const unavailable = input.items.filter((line) => {
    const variant = variantById.get(line.variantId);
    if (!variant) return true;
    return getAvailableStock(variant) < line.qty;
  });
  if (unavailable.length > 0) {
    throw new StockUnavailableError(unavailable.map((line) => line.variantId));
  }

  const { status, expiresAt } = await computeInitialOrderState(prisma, input.method, new Date());

  return prisma.$transaction(
    async (tx) => {
      const order = await tx.order.create({
        data: {
          publicCode: generatePublicCode(),
          buyerName: input.buyerName,
          phone: input.phone,
          email: input.email,
          method: input.method,
          status,
          expiresAt,
          items: {
            create: input.items.map((line) => {
              const variant = variantById.get(line.variantId)!;
              return {
                variantId: line.variantId,
                qty: line.qty,
                unitPrice: variant.priceOverride ?? variant.product.price,
              };
            }),
          },
        },
        include: { items: true },
      });

      for (const line of input.items) {
        await hold(tx, { variantId: line.variantId, qty: line.qty, orderId: order.id });
      }

      return order;
    },
    { maxWait: 10_000, timeout: 10_000 },
  );
}

// ---------------------------------------------------------------------------
// Webhook-facing lifecycle transitions (tasks.md 5.4-5.7).
//
// Backs specs/payment-mercadopago/spec.md ("Server-Side Payment
// Verification", "Idempotent Webhook Processing", "Atomic, Immediate Stock
// Decrement on Confirmed Payment", "Pending Payment States Modeled
// Explicitly") and specs/order-lifecycle/spec.md ("Order State Machine").
//
// design.md D4's idempotency guarantee lives HERE, not in the webhook
// route/service: `Payment.mpPaymentId` is UNIQUE, and the INSERT happens as
// the FIRST statement inside the same transaction as the stock decrement
// (Sequence — Payment (MercadoPago) diagram). A duplicate delivery's INSERT
// throws a Postgres unique-violation, which aborts the whole transaction —
// including the onHand/held change — before it can double-apply.
//
// The `payments` table models design.md's "Order 1─0..1 Payment" as ONE
// row per Order for its lifetime (`orderId String @unique`), so only the
// terminal `approved` confirmation writes a Payment row — this is also
// exactly what the Sequence diagram shows (Payment is only INSERTed on the
// approved path). `rejected`/`cancelled`/`pending` never write a Payment
// row: doing so would permanently consume that order's one Payment slot on
// a NON-final outcome and block a legitimate retry (e.g. a customer whose
// card is declined and then successfully pays with a second attempt/new
// mpPaymentId) from ever recording its real approved payment. Idempotency
// for those three statuses instead comes from the `order.status ===
// "PENDING_PAYMENT"` guard: once the first delivery flips the order out of
// PENDING_PAYMENT, a redelivered duplicate is a pure no-op read.
// ---------------------------------------------------------------------------

export class OrderNotFoundError extends Error {
  constructor(public readonly orderId: string) {
    super(`Order ${orderId} not found.`);
    this.name = "OrderNotFoundError";
  }
}

export interface ConfirmPaymentInput {
  orderId: string;
  mpPaymentId: string;
  amount: number;
  /** Raw MercadoPago payment payload — stored for audit only (on the
   * `approved` path, where a Payment row is written), never consulted for
   * authorization decisions. Those come from the server-side Get Payment
   * API response that produced this input, not from the untrusted
   * webhook body. */
  rawPayload: unknown;
}

export interface ConfirmPaymentResult {
  order: PendingOrder;
  /** true when this exact mpPaymentId was already processed as `approved`
   * — no state was changed by this call (D4). Always false for the
   * rejected/cancelled/pending paths, which never write a Payment row (see
   * module doc above); their own idempotency is the PENDING_PAYMENT guard,
   * not the unique-constraint mechanism. */
  duplicate: boolean;
}

/**
 * Detects a unique-constraint violation on the `payments` table's
 * mpPaymentId/orderId columns. Prisma 7's pg driver adapter reports this
 * differently from the classic query-engine client: instead of a flat
 * `error.meta.target` string array, the real Postgres constraint name and
 * quoted column list live under
 * `error.meta.driverAdapterError.cause.constraint.fields` (e.g.
 * `["\"orderId\""]`) — both shapes are checked here so this stays correct
 * regardless of which Prisma engine mode is active.
 */
function isDuplicateMpPaymentId(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const meta = error.meta as
    | { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } }
    | undefined;

  const targets = new Set<string>();
  if (Array.isArray(meta?.target)) {
    for (const field of meta.target) targets.add(String(field));
  }
  const adapterFields = meta?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(adapterFields)) {
    for (const field of adapterFields) targets.add(String(field).replace(/"/g, ""));
  }

  return targets.has("mpPaymentId") || targets.has("orderId");
}

async function findOrderOrThrow(prisma: PrismaClient, orderId: string): Promise<PendingOrder> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) {
    throw new OrderNotFoundError(orderId);
  }
  return order;
}

/**
 * tasks.md 5.4 — the Atomic Stock Decrement HARD RULE
 * (specs/payment-mercadopago "Atomic, Immediate Stock Decrement on
 * Confirmed Payment"). Writes the Payment row and decrements every line's
 * stock in ONE transaction, only when the order is still PENDING_PAYMENT
 * (an already-PAID/CANCELLED order is left untouched — design.md D4: "may
 * deliver out of order").
 *
 * tasks.md 5.7 — D4's idempotency: the Payment INSERT is the first
 * statement, so a redelivered `mpPaymentId` throws a unique-constraint
 * violation that aborts the whole transaction (nothing decrements a second
 * time) and is translated into `{ duplicate: true }` here.
 */
export async function confirmPaymentApproved(
  prisma: PrismaClient,
  input: ConfirmPaymentInput,
): Promise<ConfirmPaymentResult> {
  const existingOrder = await findOrderOrThrow(prisma, input.orderId);

  try {
    const updated = await prisma.$transaction(
      async (tx) => {
        await tx.payment.create({
          data: {
            orderId: existingOrder.id,
            mpPaymentId: input.mpPaymentId,
            status: "approved",
            rawPayload: input.rawPayload as Prisma.InputJsonValue,
            amount: input.amount,
          },
        });

        if (existingOrder.status !== "PENDING_PAYMENT") {
          return existingOrder;
        }

        for (const item of existingOrder.items) {
          await commitPaid(tx, { variantId: item.variantId, qty: item.qty, orderId: existingOrder.id });
        }
        return tx.order.update({
          where: { id: existingOrder.id },
          data: { status: "PAID", expiresAt: null },
          include: { items: true },
        });
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
    return { order: updated, duplicate: false };
  } catch (error) {
    if (isDuplicateMpPaymentId(error)) {
      return { order: existingOrder, duplicate: true };
    }
    throw error;
  }
}

/**
 * tasks.md 5.5 — rejected/cancelled payments release the held stock and
 * move the order to CANCELLED, without touching `onHand`
 * (specs/payment-mercadopago "Payment rejected or cancelled"). Guarded the
 * same way as confirmPaymentApproved: a late/out-of-order rejection for an
 * order that already transitioned (e.g. already PAID) must never undo that
 * outcome.
 */
export async function confirmPaymentRejectedOrCancelled(
  prisma: PrismaClient,
  input: ConfirmPaymentInput & { status?: "rejected" | "cancelled" },
): Promise<ConfirmPaymentResult> {
  const existingOrder = await findOrderOrThrow(prisma, input.orderId);

  if (existingOrder.status !== "PENDING_PAYMENT") {
    return { order: existingOrder, duplicate: false };
  }

  const updated = await prisma.$transaction(
    async (tx) => {
      for (const item of existingOrder.items) {
        await release(tx, { variantId: item.variantId, qty: item.qty, orderId: existingOrder.id });
      }
      return tx.order.update({
        where: { id: existingOrder.id },
        data: { status: "CANCELLED", expiresAt: null },
        include: { items: true },
      });
    },
    { maxWait: 10_000, timeout: 10_000 },
  );
  return { order: updated, duplicate: false };
}

/** D5/design.md's `pending` window: 3 days (MP's standard voucher validity
 * for Rapipago/Pago Fácil/bank transfer via MP). */
const PENDING_PAYMENT_EXTENSION_DAYS = 3;

/**
 * tasks.md 5.6 — MP `pending`/`in_process` keeps the order PENDING_PAYMENT
 * (stock stays held, nothing decremented) and extends `expiresAt` so the
 * hold survives the voucher's real-world payment window
 * (specs/payment-mercadopago "Payment left pending").
 */
export async function confirmPaymentPending(
  prisma: PrismaClient,
  input: ConfirmPaymentInput,
): Promise<ConfirmPaymentResult> {
  const existingOrder = await findOrderOrThrow(prisma, input.orderId);

  if (existingOrder.status !== "PENDING_PAYMENT") {
    return { order: existingOrder, duplicate: false };
  }

  const expiresAt = new Date(Date.now() + PENDING_PAYMENT_EXTENSION_DAYS * 24 * 60 * 60_000);
  const updated = await prisma.order.update({
    where: { id: existingOrder.id },
    data: { expiresAt },
    include: { items: true },
  });
  return { order: updated, duplicate: false };
}

// ---------------------------------------------------------------------------
// tasks.md 6.7 — staff-driven "mark picked up" transition.
//
// Backs specs/order-lifecycle/spec.md "Staff-Driven Status Transitions" /
// "Staff marks order picked up" and specs/pickup-reservation/spec.md
// "Reservation fulfilled within window". Two distinct source statuses reach
// PICKED_UP, per schema.prisma's Order.status doc ("RESERVED ->
// PAID/PICKED_UP" / "PENDING_PAYMENT -> PAID" then "PAID -> PICKED_UP"):
//
//   - PAID (MercadoPago path): stock was already committed at
//     confirmPaymentApproved() (onHand-=q, held-=q). Marking picked up here
//     is a pure status update — stock MUST NOT be touched again (the
//     order-lifecycle spec's exact wording).
//   - RESERVED (cash/transfer-at-pickup path): there is no separate online
//     payment step for this method — the customer pays in person AT
//     pickup, so THIS is the moment the reserved-unpaid stock commits to
//     sold-paid (pickup-reservation spec's "Reservation fulfilled within
//     window": "the reserved-unpaid stock SHALL transition to sold-paid").
//     commitPaid() (the same atomic onHand/held decrement used by the MP
//     webhook) runs inside the same transaction as the status update.
//
// Any other starting status (PENDING_PAYMENT, EXPIRED, CANCELLED, or an
// already-PICKED_UP order) is an invalid transition — rejected, not
// silently ignored, so staff/admin get a clear error instead of a
// double-processed stock movement.
// ---------------------------------------------------------------------------

export class InvalidOrderStatusTransitionError extends Error {
  constructor(
    public readonly orderId: string,
    public readonly fromStatus: OrderStatus,
    public readonly toStatus: OrderStatus,
  ) {
    super(`Order ${orderId} cannot transition from ${fromStatus} to ${toStatus}.`);
    this.name = "InvalidOrderStatusTransitionError";
  }
}

export async function markPickedUp(prisma: PrismaClient, orderId: string): Promise<PendingOrder> {
  const existingOrder = await findOrderOrThrow(prisma, orderId);

  if (existingOrder.status === "PAID") {
    return prisma.order.update({
      where: { id: orderId },
      data: { status: "PICKED_UP" },
      include: { items: true },
    });
  }

  if (existingOrder.status === "RESERVED") {
    return prisma.$transaction(
      async (tx) => {
        for (const item of existingOrder.items) {
          await commitPaid(tx, { variantId: item.variantId, qty: item.qty, orderId: existingOrder.id });
        }
        return tx.order.update({
          where: { id: orderId },
          data: { status: "PICKED_UP", expiresAt: null },
          include: { items: true },
        });
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  }

  throw new InvalidOrderStatusTransitionError(orderId, existingOrder.status, "PICKED_UP");
}
