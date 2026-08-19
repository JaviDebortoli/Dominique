import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import { createPendingOrder } from "@/modules/orders/order.service";
import AdminOrdersPage from "./page";

// Both OrderCancelButton and OrderPickupButton are client components that
// call useRouter() unconditionally on render — mirrors
// OrderCancelButton.test.tsx's next/navigation mock (the RSC precedent in
// /pedido/[code]/page.test.tsx needed no such mock because that page has no
// client-component descendants).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// Closes sdd-verify's CRITICAL gap on 2026-08-18-admin-cancelar-pedido:
// specs/order-lifecycle/spec.md's "Cancel affordance visibility on the
// admin orders list" scenario had zero runtime coverage —
// OrderCancelButton.test.tsx only exercises the button's own click/confirm
// behavior, never the CANCEL_ELIGIBLE.includes(order.status) conditional
// gate in page.tsx that decides whether the button renders at all. This
// renders the real AdminOrdersPage server component (mirrors the
// /pedido/[code] page.test.tsx precedent of calling an RSC directly and
// passing the result to render()) against seeded real-Postgres orders in
// every OrderStatus, and asserts on the actual rendered row.
describe("/admin/pedidos — cancel affordance visibility (integration, real Postgres)", () => {
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

  async function makeOrderWithStatus(status: OrderStatus) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Pedidos Visibility ${suffix}`, slug: `pedidos-visibility-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Producto Visibility ${suffix}`,
      slug: `producto-visibility-${suffix}`,
      price: 8000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `VIS-${suffix}`, onHand: 5 }],
    });
    createdProductIds.push(product.id);

    // RESERVED is reached the same way the rest of the suite reaches it
    // (order.service.test.ts: PICKUP_CASH -> RESERVED) rather than being
    // force-set, since it must land here already CANCEL_ELIGIBLE AND
    // PICKUP_ELIGIBLE at once (the only status showing both buttons).
    const order = await createPendingOrder(prisma, {
      buyerName: "Cliente Visibilidad",
      phone: "3815550099",
      email: "visibility@example.com",
      method: status === "RESERVED" ? "PICKUP_CASH" : "MP",
      items: [{ variantId: product.variants[0].id, qty: 1 }],
    });
    createdOrderIds.push(order.id);

    if (order.status !== status) {
      await prisma.order.update({ where: { id: order.id }, data: { status } });
    }

    return order;
  }

  async function renderRowFor(status: OrderStatus) {
    const order = await makeOrderWithStatus(status);
    const ui = await AdminOrdersPage();
    render(ui);
    const cell = screen.getByText(order.publicCode);
    const row = cell.closest("tr");
    if (!row) {
      throw new Error(`no <tr> found for order ${order.publicCode}`);
    }
    return within(row);
  }

  it("renders Cancelar for a PENDING_PAYMENT order", async () => {
    const row = await renderRowFor("PENDING_PAYMENT");
    expect(row.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(row.queryByRole("button", { name: "Marcar retirado" })).not.toBeInTheDocument();
  });

  it("renders both Cancelar and Marcar retirado for a RESERVED order", async () => {
    const row = await renderRowFor("RESERVED");
    expect(row.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Marcar retirado" })).toBeInTheDocument();
  });

  it("hides Cancelar for a PAID order (shows Marcar retirado instead)", async () => {
    const row = await renderRowFor("PAID");
    expect(row.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
    expect(row.getByRole("button", { name: "Marcar retirado" })).toBeInTheDocument();
  });

  it.each([["PICKED_UP" as const], ["EXPIRED" as const], ["CANCELLED" as const]])(
    "hides both Cancelar and Marcar retirado for a %s order",
    async (status) => {
      const row = await renderRowFor(status);
      expect(row.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
      expect(row.queryByRole("button", { name: "Marcar retirado" })).not.toBeInTheDocument();
    },
  );
});
