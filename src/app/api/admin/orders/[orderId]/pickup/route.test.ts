import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";
import { createProduct } from "@/modules/catalog/product.service";
import { confirmPaymentApproved, createPendingOrder } from "@/modules/orders/order.service";

// HTTP-level tests for the staff "mark picked up" action — thin wiring over
// order.service.ts's markPickedUp() (design.md D1, tasks.md 6.7's already
// -tested logic). Backs specs/admin-console/spec.md "Order Status
// Management" ("staff updates order status, visible via customer's
// /pedido/[code] lookup") and "Authenticated Access". tasks.md 7.1/7.9.
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { POST } = await import("./route");

function request(): Request {
  return new Request("http://localhost/api/admin/orders/x/pickup", { method: "POST" });
}

function ctx(orderId: string) {
  return { params: Promise.resolve({ orderId }) };
}

describe("POST /api/admin/orders/[orderId]/pickup (integration, real Postgres)", () => {
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

  async function makePaidOrder() {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Pickup Route Test ${suffix}`, slug: `pickup-route-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    const product = await createProduct(prisma, {
      name: `Producto Pickup ${suffix}`,
      slug: `producto-pickup-${suffix}`,
      price: 18000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `PICKUP-${suffix}`, onHand: 3 }],
    });
    createdProductIds.push(product.id);

    const order = await createPendingOrder(prisma, {
      buyerName: "Comprador Pickup",
      phone: "3815550005",
      email: "pickup@example.com",
      method: "MP",
      items: [{ variantId: product.variants[0]!.id, qty: 1 }],
    });
    createdOrderIds.push(order.id);
    await confirmPaymentApproved(prisma, {
      orderId: order.id,
      mpPaymentId: `pickup-route-${randomUUID()}`,
      amount: 18000,
      rawPayload: { status: "approved" },
    });
    return order;
  }

  it("rejects an unauthenticated request with 401 and leaves the order untouched", async () => {
    mockedAuth.mockResolvedValueOnce(null);
    const order = await makePaidOrder();

    const response = await POST(request(), ctx(order.id));

    expect(response.status).toBe(401);
    const unchanged = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.status).toBe("PAID");
  });

  it("marks a PAID order PICKED_UP for an authenticated staff session (visible via customer lookup)", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const order = await makePaidOrder();

    const response = await POST(request(), ctx(order.id));

    expect(response.status).toBe(200);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("PICKED_UP");
  });

  it("returns 409 for an order that cannot transition to PICKED_UP (e.g. already CANCELLED)", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Pickup Invalid ${suffix}`, slug: `pickup-invalid-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    const product = await createProduct(prisma, {
      name: `Producto Pickup Invalid ${suffix}`,
      slug: `producto-pickup-invalid-${suffix}`,
      price: 9000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `PICKUPINV-${suffix}`, onHand: 1 }],
    });
    createdProductIds.push(product.id);
    const order = await createPendingOrder(prisma, {
      buyerName: "Comprador Cancelado",
      phone: "3815550006",
      email: "cancelado@example.com",
      method: "MP",
      items: [{ variantId: product.variants[0]!.id, qty: 1 }],
    });
    createdOrderIds.push(order.id);
    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });

    const response = await POST(request(), ctx(order.id));

    expect(response.status).toBe(409);
  });

  it("returns 404 for an order id that does not exist", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());

    const response = await POST(request(), ctx("does-not-exist"));

    expect(response.status).toBe(404);
  });
});
