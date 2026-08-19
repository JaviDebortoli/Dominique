import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";
import { createProduct } from "@/modules/catalog/product.service";
import { createPendingOrder } from "@/modules/orders/order.service";

// HTTP-level tests for the staff "cancel order" action — thin wiring over
// order.service.ts's cancelOrder() (design.md D1, proposal
// 2026-08-18-admin-cancelar-pedido). Mirrors pickup/route.test.ts's
// conventions (makeAuthMockModule, ctx(), real Postgres, afterAll cleanup).
// Backs specs/order-lifecycle/spec.md's cancel scenarios.
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { POST } = await import("./route");

function request(): Request {
  return new Request("http://localhost/api/admin/orders/x/cancel", { method: "POST" });
}

function ctx(orderId: string) {
  return { params: Promise.resolve({ orderId }) };
}

describe("POST /api/admin/orders/[orderId]/cancel (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdOrderIds: string[] = [];

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.stockMovement.deleteMany({
      where: { variant: { productId: { in: createdProductIds } } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makePendingOrder(method: "MP" | "PICKUP_CASH" = "MP") {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Cancel Route Test ${suffix}`, slug: `cancel-route-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    const product = await createProduct(prisma, {
      name: `Producto Cancel ${suffix}`,
      slug: `producto-cancel-${suffix}`,
      price: 18000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `CANCEL-${suffix}`, onHand: 3 }],
    });
    createdProductIds.push(product.id);

    const order = await createPendingOrder(prisma, {
      buyerName: "Comprador Cancel",
      phone: "3815550007",
      email: "cancel@example.com",
      method,
      items: [{ variantId: product.variants[0]!.id, qty: 1 }],
    });
    createdOrderIds.push(order.id);
    return order;
  }

  it("rejects an unauthenticated request with 401 and leaves the order untouched", async () => {
    mockedAuth.mockResolvedValueOnce(null);
    const order = await makePendingOrder();

    const response = await POST(request(), ctx(order.id));

    expect(response.status).toBe(401);
    const unchanged = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.status).toBe("PENDING_PAYMENT");
  });

  it("cancels a PENDING_PAYMENT order for an authenticated staff session", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const order = await makePendingOrder();

    const response = await POST(request(), ctx(order.id));

    expect(response.status).toBe(200);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("CANCELLED");
  });

  it("cancels a RESERVED order for an authenticated staff session", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const order = await makePendingOrder("PICKUP_CASH");

    const response = await POST(request(), ctx(order.id));

    expect(response.status).toBe(200);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("CANCELLED");
  });

  it("returns 404 for an order id that does not exist", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());

    const response = await POST(request(), ctx("does-not-exist"));

    expect(response.status).toBe(404);
  });

  it("returns 409 with the MercadoPago message verbatim for a PAID order, and leaves it untouched", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const order = await makePendingOrder();
    await prisma.order.update({ where: { id: order.id }, data: { status: "PAID" } });

    const response = await POST(request(), ctx(order.id));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.message).toBe(
      "No se puede cancelar: ya está pagado. Para reembolsar, gestionalo desde MercadoPago.",
    );
    const unchanged = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.status).toBe("PAID");
  });

  it("returns 409 with the generic message for an already-CANCELLED order, and leaves it untouched", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const order = await makePendingOrder();
    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });

    const response = await POST(request(), ctx(order.id));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.message).toBe("No se puede cancelar un pedido en este estado.");
    const unchanged = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.status).toBe("CANCELLED");
  });
});
