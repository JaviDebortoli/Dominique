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

// `Order.phone` is stored as the buyer typed it (trimmed) — digits plus
// visual separators the checkout allows (space, (), +, ., -). Strip
// everything but digits and a leading + for the tel: URI; the cell still
// shows the original string.
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

// One prep line for the Ítems cell: "2× Vestido Roma · S / Negro · VEST-S-NEG".
// Everything staff need to pick the order off the shelf, in one text node.
type OrderLineInput = {
  qty: number;
  variant: { size: string; color: string; sku: string; product: { name: string } };
};
function formatOrderLine(item: OrderLineInput): string {
  const { qty, variant } = item;
  return `${qty}× ${variant.product.name} · ${variant.size} / ${variant.color} · ${variant.sku}`;
}

// proposal 2026-08-18-admin-cancelar-pedido — cancel is offered only before
// any payment has committed or reserved-unpaid stock has been picked up;
// PAID stays out of scope (staff refund manually via MercadoPago).
const CANCEL_ELIGIBLE: OrderStatus[] = ["PENDING_PAYMENT", "RESERVED"];

export default async function AdminOrdersPage() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      items: {
        include: { variant: { include: { product: { select: { name: true } } } } },
      },
    },
  });

  return (
    <section className="flex flex-col gap-6">
      <h1 className="font-serif text-headline-md text-ink">Pedidos</h1>

      <div className="overflow-x-auto border border-ink/15">
        <table className="w-full border-collapse font-sans text-body-md text-ink">
          <thead>
            <tr className="divide-x divide-ink/10 border-b border-ink/20 bg-surface text-left align-middle font-sans text-label-caps uppercase tracking-widest text-outline">
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Comprador</th>
              <th className="px-4 py-3 font-semibold">Método</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 text-center font-semibold">Ítems</th>
              <th className="px-4 py-3 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr
                key={order.id}
                className="divide-x divide-ink/10 border-b border-ink/10 align-middle last:border-b-0 hover:bg-surface"
              >
                <td className="px-4 py-3 font-medium tabular-nums">{order.publicCode}</td>
                <td className="px-4 py-3">
                  {order.buyerName}
                  <div className="text-label-caps text-outline">{order.email}</div>
                  <div className="text-label-caps text-outline">
                    Teléfono:{" "}
                    <a href={telHref(order.phone)} className="underline hover:text-ink">
                      {order.phone}
                    </a>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {order.method === "MP" ? "MercadoPago" : "Retiro en local"}
                </td>
                <td className="px-4 py-3">{STATUS_LABELS_ES_AR[order.status]}</td>
                <td className="px-4 py-3 align-top">
                  <details className="group">
                    <summary className="cursor-pointer list-none text-center tabular-nums marker:content-none">
                      {order.items.reduce((sum, item) => sum + item.qty, 0)}
                      <span className="ml-1 text-outline group-open:hidden">▸</span>
                      <span className="ml-1 text-outline hidden group-open:inline">▾</span>
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1 text-body-sm text-ink">
                      {order.items.map((item) => (
                        <li key={item.id}>{formatOrderLine(item)}</li>
                      ))}
                    </ul>
                  </details>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-end gap-2">
                    {PICKUP_ELIGIBLE.includes(order.status) ? (
                      <OrderPickupButton
                        orderId={order.id}
                        requiresPaymentMethod={
                          order.method === "PICKUP_CASH" && !order.paymentMethod
                        }
                      />
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
                <td colSpan={6} className="px-4 py-8 text-center text-outline">
                  Todavía no hay pedidos.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
