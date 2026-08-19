// /admin/pedidos — staff order list + status actions (tasks.md 7.9).
// specs/admin-console/spec.md "Order Status Management": "staff marks it
// ready for pickup ... visible to the customer via order lookup". Reuses
// order.service.ts's markPickedUp() through the already-tested
// /api/admin/orders/[orderId]/pickup route (design.md D1) — this page only
// reads.
import { prisma } from "@/lib/db";
import type { OrderStatus } from "@/generated/prisma/client";
import { OrderPickupButton } from "@/components/admin/OrderPickupButton";
import { OrderCancelButton } from "@/components/admin/OrderCancelButton";

export const dynamic = "force-dynamic";

// Same es-AR labels as app/(store)/pedido/[code]/page.tsx (Phase 6) — kept
// local rather than importing from that page module, which does not export
// it and is storefront-scoped.
const STATUS_LABELS_ES_AR: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Pendiente",
  RESERVED: "Reservado",
  PAID: "Pagado",
  PICKED_UP: "Retirado",
  EXPIRED: "Vencido",
  CANCELLED: "Cancelado",
};

const PICKUP_ELIGIBLE: OrderStatus[] = ["PAID", "RESERVED"];

// proposal 2026-08-18-admin-cancelar-pedido — cancel is offered only before
// any payment has committed or reserved-unpaid stock has been picked up;
// PAID stays out of scope (staff refund manually via MercadoPago).
const CANCEL_ELIGIBLE: OrderStatus[] = ["PENDING_PAYMENT", "RESERVED"];

export default async function AdminOrdersPage() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { items: true },
  });

  return (
    <section className="flex flex-col gap-6">
      <h1 className="font-serif text-headline-md text-ink">Pedidos</h1>

      <table className="w-full border-collapse font-sans text-body-md text-ink">
        <thead>
          <tr className="border-b border-ink/20 text-left">
            <th className="py-2">Código</th>
            <th className="py-2">Comprador</th>
            <th className="py-2">Método</th>
            <th className="py-2">Estado</th>
            <th className="py-2 text-right">Ítems</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-b border-ink/10">
              <td className="py-2">{order.publicCode}</td>
              <td className="py-2">
                {order.buyerName}
                <div className="text-label-caps text-outline">{order.email}</div>
              </td>
              <td className="py-2">{order.method === "MP" ? "MercadoPago" : "Retiro en local"}</td>
              <td className="py-2">{STATUS_LABELS_ES_AR[order.status]}</td>
              <td className="py-2 text-right">
                {order.items.reduce((sum, item) => sum + item.qty, 0)}
              </td>
              <td className="py-2">
                <div className="flex flex-col items-end gap-2">
                  {PICKUP_ELIGIBLE.includes(order.status) ? (
                    <OrderPickupButton orderId={order.id} />
                  ) : null}
                  {CANCEL_ELIGIBLE.includes(order.status) ? (
                    <OrderCancelButton orderId={order.id} publicCode={order.publicCode} />
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
          {orders.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-6 text-center text-outline">
                Todavía no hay pedidos.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
