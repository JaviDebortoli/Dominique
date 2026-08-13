import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import { createPendingOrder } from "@/modules/orders/order.service";
import OrderStatusPage from "./page";

// Backs specs/payment-mercadopago/spec.md "Server-Side Payment
// Verification" ("Client redirected to success page before webhook arrives"
// — order MUST remain pending until server-side confirmation) and
// design.md's back_urls note ("display only — params NEVER trusted").
// tasks.md 5.8: this page reads ONLY the DB; MercadoPago's redirect query
// params (payment_id/status/preference_id/collection_status, etc.) are
// never consulted, even when they exist on the request and CONTRADICT the
// real DB status — proven below by passing a searchParams object that
// lies about the order being "approved" while the DB still says pending.
//
// Full es-AR status label coverage across every OrderStatus value (task
// 6.6) is Phase 6 scope — this page currently renders the two statuses
// reachable by the end of Phase 5 (PENDING_PAYMENT reachable via
// createPendingOrder; PAID exercised directly via prisma.order.update, the
// same pattern webhook.service.test.ts uses to reach that state).
describe("/pedido/[code] — order status lookup (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdOrderIds: string[] = [];

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.stockMovement.deleteMany({
      where: { variant: { productId: { in: createdProductIds } } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makePendingOrder() {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Pedido Lookup ${suffix}`, slug: `pedido-lookup-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Producto Pedido ${suffix}`,
      slug: `producto-pedido-${suffix}`,
      price: 9000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `PED-${suffix}`, onHand: 3 }],
    });
    createdProductIds.push(product.id);

    const order = await createPendingOrder(prisma, {
      buyerName: "Cliente Pedido",
      phone: "3815550088",
      email: "pedido@example.com",
      method: "MP",
      items: [{ variantId: product.variants[0].id, qty: 1 }],
    });
    createdOrderIds.push(order.id);
    return order;
  }

  it("shows the real DB status even when a contradicting searchParams claims the payment was approved", async () => {
    const order = await makePendingOrder();

    const ui = await OrderStatusPage({
      params: Promise.resolve({ code: order.publicCode }),
      searchParams: Promise.resolve({ status: "approved", payment_id: "999999", collection_status: "approved" }),
    });
    render(ui);

    expect(screen.getByText(new RegExp(order.publicCode))).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.queryByText(/pagado/i)).not.toBeInTheDocument();
  });

  it("triangulation: a PAID order (set directly in the DB, not via any query param) shows Pagado", async () => {
    const order = await makePendingOrder();
    await prisma.order.update({ where: { id: order.id }, data: { status: "PAID", expiresAt: null } });

    const ui = await OrderStatusPage({
      params: Promise.resolve({ code: order.publicCode }),
      searchParams: Promise.resolve({}),
    });
    render(ui);

    expect(screen.getByText("Pagado")).toBeInTheDocument();
  });

  // task 6.6 — full es-AR label coverage across every OrderStatus value.
  // "Listo para retirar" (specs/order-lifecycle "Status Visible via Order
  // Lookup") is NOT a separate Order.status enum value (there is no
  // standalone "ready" state in the MVP, per the owner's decision) — PAID
  // doubles as both "paid" and "ready for pickup" (pickup-only store: once
  // paid online, there is nothing left to prepare/ship), so it renders as
  // an additional indicator alongside the "Pagado" label rather than
  // replacing it.
  describe("full es-AR status label coverage (task 6.6)", () => {
    it("PAID additionally shows the 'Listo para retirar' indicator", async () => {
      const order = await makePendingOrder();
      await prisma.order.update({ where: { id: order.id }, data: { status: "PAID", expiresAt: null } });

      const ui = await OrderStatusPage({
        params: Promise.resolve({ code: order.publicCode }),
        searchParams: Promise.resolve({}),
      });
      render(ui);

      expect(screen.getByText("Pagado")).toBeInTheDocument();
      expect(screen.getByText("Listo para retirar")).toBeInTheDocument();
    });

    it("RESERVED shows Reservado, without the 'Listo para retirar' indicator (not paid yet)", async () => {
      const order = await makePendingOrder();
      await prisma.order.update({
        where: { id: order.id },
        data: { status: "RESERVED", expiresAt: new Date(Date.now() + 60_000) },
      });

      const ui = await OrderStatusPage({
        params: Promise.resolve({ code: order.publicCode }),
        searchParams: Promise.resolve({}),
      });
      render(ui);

      expect(screen.getByText("Reservado")).toBeInTheDocument();
      expect(screen.queryByText("Listo para retirar")).not.toBeInTheDocument();
    });

    it("PICKED_UP shows Retirado", async () => {
      const order = await makePendingOrder();
      await prisma.order.update({ where: { id: order.id }, data: { status: "PICKED_UP", expiresAt: null } });

      const ui = await OrderStatusPage({
        params: Promise.resolve({ code: order.publicCode }),
        searchParams: Promise.resolve({}),
      });
      render(ui);

      expect(screen.getByText("Retirado")).toBeInTheDocument();
    });

    it("EXPIRED shows Vencido", async () => {
      const order = await makePendingOrder();
      await prisma.order.update({ where: { id: order.id }, data: { status: "EXPIRED", expiresAt: null } });

      const ui = await OrderStatusPage({
        params: Promise.resolve({ code: order.publicCode }),
        searchParams: Promise.resolve({}),
      });
      render(ui);

      expect(screen.getByText("Vencido")).toBeInTheDocument();
    });

    it("CANCELLED shows Cancelado", async () => {
      const order = await makePendingOrder();
      await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED", expiresAt: null } });

      const ui = await OrderStatusPage({
        params: Promise.resolve({ code: order.publicCode }),
        searchParams: Promise.resolve({}),
      });
      render(ui);

      expect(screen.getByText("Cancelado")).toBeInTheDocument();
    });
  });

  it("throws (notFound) for an unknown order code", async () => {
    await expect(
      OrderStatusPage({
        params: Promise.resolve({ code: `NOPE-${randomUUID()}` }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow();
  });
});
