// Caja (register) read-model — the admin "/admin/caja" stock view
// (design.md "Admin /admin/caja (register screen, rule 4c)"). Read-only:
// this module NEVER mutates Variant.onHand/held — see stock.service.ts for
// the only writers. tasks.md 7.6/7.10.
//
// Backs specs/admin-console/spec.md "Real-Time-Accurate Stock View Before
// In-Person Sale (HARD RULE)" and specs/inventory-stock/spec.md "Distinct
// Stock States".
//
// Three numbers per variant, all derived from the SAME live read (no cache,
// no denormalized counters beyond onHand/held themselves):
//   - disponible  = onHand - held                     (sellable right now)
//   - reservado   = held                               (reserved-unpaid —
//     Variant.held is, by construction, only ever incremented by hold() and
//     decremented by release()/commitPaid(), so it IS exactly the current
//     reserved-unpaid total; no extra join needed for the NUMBER, only for
//     the per-buyer breakdown below)
//   - enDeposito  = sum of OrderItem.qty for this variant across orders
//     still `PAID` (not yet PICKED_UP) — "sold-paid" stock that already left
//     onHand (commitPaid() decrements onHand at payment time, design.md
//     Sequence — Payment) but is still physically on the premises awaiting
//     the buyer's pickup. Once PICKED_UP the garment has genuinely left the
//     building, so it stops counting here.
import type { PrismaClient } from "@/generated/prisma/client";

export interface CajaReservation {
  orderId: string;
  buyerName: string;
  expiresAt: Date | null;
  qty: number;
}

export interface CajaRow {
  variantId: string;
  productName: string;
  size: string;
  color: string;
  sku: string;
  disponible: number;
  reservado: number;
  enDeposito: number;
  /** Buyer + expiry per active reserved-unpaid hold on this variant
   * (design.md: "reserved rows list buyer name and expiry so staff never
   * hand over a held or paid garment"). Empty when reservado === 0. */
  reservations: CajaReservation[];
}

export interface GetCajaRowsOptions {
  /** Case-insensitive substring match against product name or variant SKU
   * (design.md: "SKU/name search"). */
  search?: string;
}

export async function getCajaRows(
  prisma: PrismaClient,
  options: GetCajaRowsOptions = {},
): Promise<CajaRow[]> {
  const search = options.search?.trim();

  const variants = await prisma.variant.findMany({
    where: search
      ? {
          OR: [
            { sku: { contains: search, mode: "insensitive" } },
            { product: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : undefined,
    include: { product: { select: { name: true } } },
    orderBy: [{ product: { name: "asc" } }, { size: "asc" }, { color: "asc" }],
  });

  if (variants.length === 0) {
    return [];
  }

  const variantIds = variants.map((v) => v.id);

  // "en depósito" (sold-paid, awaiting pickup) — grouped sum, one query.
  const paidGroups = await prisma.orderItem.groupBy({
    by: ["variantId"],
    where: { variantId: { in: variantIds }, order: { status: "PAID" } },
    _sum: { qty: true },
  });
  const enDepositoByVariant = new Map(
    paidGroups.map((group) => [group.variantId, group._sum.qty ?? 0]),
  );

  // Active reserved-unpaid holds — RESERVED (pickup cash/transfer) and
  // PENDING_PAYMENT (MP checkout in flight) are BOTH "reserved-unpaid"
  // holds on `held` (design.md D2); staff must not sell either in person.
  const activeOrders = await prisma.order.findMany({
    where: {
      status: { in: ["RESERVED", "PENDING_PAYMENT"] },
      items: { some: { variantId: { in: variantIds } } },
    },
    select: {
      id: true,
      buyerName: true,
      expiresAt: true,
      items: { where: { variantId: { in: variantIds } }, select: { variantId: true, qty: true } },
    },
  });

  const reservationsByVariant = new Map<string, CajaReservation[]>();
  for (const order of activeOrders) {
    for (const item of order.items) {
      const list = reservationsByVariant.get(item.variantId) ?? [];
      list.push({
        orderId: order.id,
        buyerName: order.buyerName,
        expiresAt: order.expiresAt,
        qty: item.qty,
      });
      reservationsByVariant.set(item.variantId, list);
    }
  }

  return variants.map((variant) => ({
    variantId: variant.id,
    productName: variant.product.name,
    size: variant.size,
    color: variant.color,
    sku: variant.sku,
    disponible: variant.onHand - variant.held,
    reservado: variant.held,
    enDeposito: enDepositoByVariant.get(variant.id) ?? 0,
    reservations: reservationsByVariant.get(variant.id) ?? [],
  }));
}
