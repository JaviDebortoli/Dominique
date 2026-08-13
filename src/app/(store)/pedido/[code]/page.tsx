import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import type { OrderStatus } from "@/generated/prisma/client";

// Order status lookup. Backs specs/payment-mercadopago/spec.md "Server-Side
// Payment Verification" and design.md's back_urls note: MercadoPago's
// success/pending/failure redirect ALWAYS lands here with query params
// (payment_id, status, collection_status, preference_id, ...) that are
// PURELY DISPLAY-LAYER on MercadoPago's side and are NEVER read by this
// page — the only source of truth for order status is the DB row, which is
// only ever written by the server-verified webhook
// (src/modules/payments/webhook.service.ts). This is why `searchParams` is
// accepted (Next.js requires acknowledging it as a param) but deliberately
// never destructured or used below (see page.test.tsx's contradicting-
// searchParams test, which proves this).
//
// tasks.md 5.8/6.6. Full es-AR label coverage for every OrderStatus value
// (specs/order-lifecycle/spec.md "Status Visible via Order Lookup":
// "Pendiente", "Pagado", "Reservado", "Listo para retirar", "Retirado",
// "Cancelado", "Vencido").
//
// "Listo para retirar" is NOT a separate OrderStatus enum value — there is
// no standalone "ready for pickup" state in this MVP (see
// schema.prisma's OrderStatus doc and design.md's Data Model Sketch: the
// enum has exactly 6 values). Because this is a pickup-ONLY store, a PAID
// online order has nothing left to prepare or ship — it is ready for
// pickup the instant it is paid — so PAID renders BOTH the "Pagado" label
// and a "Listo para retirar" indicator. RESERVED (cash/transfer-at-pickup,
// not yet paid) intentionally does NOT show that indicator.

const STATUS_LABELS_ES_AR: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Pendiente",
  RESERVED: "Reservado",
  PAID: "Pagado",
  PICKED_UP: "Retirado",
  EXPIRED: "Vencido",
  CANCELLED: "Cancelado",
};

interface OrderStatusPageProps {
  params: Promise<{ code: string }>;
  // Intentionally unused — see module doc above. Typed so Next.js's App
  // Router page-props contract is satisfied without silently swallowing a
  // future accidental read of a trusted-looking field.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OrderStatusPage({ params }: OrderStatusPageProps) {
  const { code } = await params;

  const order = await prisma.order.findUnique({ where: { publicCode: code } });
  if (!order) {
    notFound();
  }

  return (
    <section className="mx-auto max-w-container px-margin-mobile py-section md:px-gutter">
      <h1 className="mb-4 font-serif text-headline-lg-mobile text-ink md:text-headline-lg">
        Pedido {order.publicCode}
      </h1>
      <p className="font-sans text-body-md text-ink">
        Estado: <span className="font-semibold">{STATUS_LABELS_ES_AR[order.status]}</span>
      </p>
      {order.status === "PAID" && (
        <p className="mt-2 font-sans text-body-md text-ink">Listo para retirar</p>
      )}
    </section>
  );
}
