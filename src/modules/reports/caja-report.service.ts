// Revenue report — read-only aggregation over Sale (in-person) and Order
// (MercadoPago / PICKUP_CASH) rows (control-de-caja design.md diagram (d)).
//
// Backs specs/sales-revenue/spec.md "Revenue Aggregation by Period and
// Payment Method" and its "No double-counting", "Voided sale excluded", and
// "Honest empty state for pre-ship-date ranges" scenarios.

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { resolveReportRange } from "@/lib/report-day";

export type RevenueBucket = "CASH" | "TRANSFER" | "MP" | "UNKNOWN";

const ZERO_TOTALS = (): Record<RevenueBucket, Prisma.Decimal> => ({
  CASH: new Prisma.Decimal(0),
  TRANSFER: new Prisma.Decimal(0),
  MP: new Prisma.Decimal(0),
  UNKNOWN: new Prisma.Decimal(0),
});

export interface SaleForMerge {
  paymentMethod: "CASH" | "TRANSFER";
  qty: number;
  unitPrice: Prisma.Decimal | number;
}

export interface OrderItemForMerge {
  qty: number;
  unitPrice: Prisma.Decimal | number;
}

export interface OrderForMerge {
  method: "MP" | "PICKUP_CASH";
  paymentMethod: "CASH" | "TRANSFER" | null;
  items: OrderItemForMerge[];
}

export interface MergedRevenue {
  totals: Record<RevenueBucket, Prisma.Decimal>;
  grandTotal: Prisma.Decimal;
  inPerson: Record<"CASH" | "TRANSFER", Prisma.Decimal>;
  fromOrders: Record<RevenueBucket, Prisma.Decimal>;
}

/**
 * design.md diagram (d)'s bucketing rule, as a pure function so it's
 * unit-testable with faked Q1/Q3 results (tasks.md 5.3):
 *   - every in-person Sale (already filtered to `voidedAt IS NULL`) buckets
 *     by its own `paymentMethod` — CASH or TRANSFER, never split.
 *   - every Order (already deduped to one row per orderId, filtered to
 *     `status IN (PAID, PICKED_UP)`) sums its items ONCE, then buckets by
 *     `method === "MP" ? MP : (paymentMethod ?? UNKNOWN)` — a PICKUP_CASH
 *     order with no recorded method (legacy, pre-D3 backfill-none) lands in
 *     the UNKNOWN bucket rather than being silently dropped or guessed.
 * `Sale` and `Order` rows never reference each other, so there is no
 * double-counting BY CONSTRUCTION (design.md's own claim) — this function
 * only sums what its caller already deduplicated.
 */
export function mergeRevenue(sales: SaleForMerge[], orders: OrderForMerge[]): MergedRevenue {
  const totals = ZERO_TOTALS();
  const fromOrders = ZERO_TOTALS();
  const inPerson = { CASH: new Prisma.Decimal(0), TRANSFER: new Prisma.Decimal(0) };

  for (const sale of sales) {
    const amount = new Prisma.Decimal(sale.unitPrice).times(sale.qty);
    inPerson[sale.paymentMethod] = inPerson[sale.paymentMethod].plus(amount);
    totals[sale.paymentMethod] = totals[sale.paymentMethod].plus(amount);
  }

  for (const order of orders) {
    const amount = order.items.reduce(
      (sum, item) => sum.plus(new Prisma.Decimal(item.unitPrice).times(item.qty)),
      new Prisma.Decimal(0),
    );
    const bucket: RevenueBucket =
      order.method === "MP" ? "MP" : (order.paymentMethod ?? "UNKNOWN");
    totals[bucket] = totals[bucket].plus(amount);
    fromOrders[bucket] = fromOrders[bucket].plus(amount);
  }

  const grandTotal = (Object.keys(totals) as RevenueBucket[]).reduce(
    (sum, bucket) => sum.plus(totals[bucket]),
    new Prisma.Decimal(0),
  );

  return { totals, grandTotal, inPerson, fromOrders };
}

export interface RevenueReport extends MergedRevenue {
  /** Half-open range actually queried — [from, to). */
  from: Date;
  to: Date;
  counts: { sales: number; voidedSales: number; orders: number };
  /** specs/sales-revenue/spec.md "Honest empty state for pre-ship-date
   * ranges": true when the ENTIRE requested range falls before this
   * change's ship date, meaning no in-person Sale data could possibly
   * exist yet (the table/feature did not exist) — the UI must show an
   * explicit message instead of presenting whatever totals come back as a
   * complete picture. */
  limitedData: boolean;
}

/** design.md D3/"Backfill: none" — the same accepted-limitation category as
 * the pre-ship-date Sale gap this flag protects against. Set to the date
 * this capability shipped; a request whose range ends at or before this
 * instant is entirely pre-ship. */
const CONTROL_DE_CAJA_SHIP_DATE = new Date("2026-09-12T00:00:00.000Z");

/**
 * design.md diagram (d): Q1 (non-voided Sale rows in range) + Q2
 * (distinct orderIds from StockMovement(PAID) in range — the dedupe a
 * multi-line order's per-line PAID rows need) + Q3 (those orders,
 * status-filtered, with items) → mergeRevenue().
 */
export async function getRevenueReport(
  prisma: PrismaClient,
  range: { from: string; to: string },
): Promise<RevenueReport> {
  const { from, to } = resolveReportRange(range);

  const [sales, voidedSalesCount, paidMovements] = await Promise.all([
    prisma.sale.findMany({
      where: { voidedAt: null, soldAt: { gte: from, lt: to } },
      select: { paymentMethod: true, qty: true, unitPrice: true },
    }),
    prisma.sale.count({
      where: { voidedAt: { not: null }, soldAt: { gte: from, lt: to } },
    }),
    // Q2 — distinct: ["orderId"] is load-bearing (design.md diagram (d)):
    // commitPaid() writes one StockMovement(PAID) row PER ORDER LINE, so
    // without this a 3-line order would be summed three times.
    prisma.stockMovement.findMany({
      where: { reason: "PAID", at: { gte: from, lt: to }, orderId: { not: null } },
      distinct: ["orderId"],
      select: { orderId: true },
    }),
  ]);

  const orderIds = paidMovements
    .map((movement) => movement.orderId)
    .filter((id): id is string => id !== null);

  const orders =
    orderIds.length > 0
      ? await prisma.order.findMany({
          where: { id: { in: orderIds }, status: { in: ["PAID", "PICKED_UP"] } },
          select: { method: true, paymentMethod: true, items: { select: { qty: true, unitPrice: true } } },
        })
      : [];

  const merged = mergeRevenue(sales, orders);
  const limitedData = to.getTime() <= CONTROL_DE_CAJA_SHIP_DATE.getTime();

  return {
    from,
    to,
    ...merged,
    counts: { sales: sales.length, voidedSales: voidedSalesCount, orders: orders.length },
    limitedData,
  };
}
