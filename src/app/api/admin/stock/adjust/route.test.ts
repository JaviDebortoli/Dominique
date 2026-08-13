import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";
import { createProduct } from "@/modules/catalog/product.service";
import { hold } from "@/modules/inventory/stock.service";

// HTTP-level tests for manual stock reconciliation — thin wiring over
// stock.service.ts's adjust(). Backs specs/inventory-stock/spec.md "Manual
// Admin Reconciliation" ("the corrected value SHALL apply immediately
// across storefront and admin views"). tasks.md 7.1/7.8.
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { POST } = await import("./route");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/stock/adjust", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/stock/adjust (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({
      where: { variant: { productId: { in: createdProductIds } } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makeVariant(onHand: number) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Adjust Route Test ${suffix}`, slug: `adjust-route-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    const product = await createProduct(prisma, {
      name: `Producto Adjust ${suffix}`,
      slug: `producto-adjust-${suffix}`,
      price: 15000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `ADJ-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);
    return product.variants[0];
  }

  it("rejects an unauthenticated request with 401 and changes nothing", async () => {
    mockedAuth.mockResolvedValueOnce(null);
    const variant = await makeVariant(3);

    const response = await POST(jsonRequest({ variantId: variant.id, delta: -1 }));

    expect(response.status).toBe(401);
    const unchanged = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(unchanged.onHand).toBe(3);
  });

  it("applies a positive correction immediately", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const variant = await makeVariant(2);

    const response = await POST(jsonRequest({ variantId: variant.id, delta: 3 }));

    expect(response.status).toBe(200);
    const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updated.onHand).toBe(5);
  });

  it("applies a negative correction immediately", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const variant = await makeVariant(5);

    const response = await POST(jsonRequest({ variantId: variant.id, delta: -2 }));

    expect(response.status).toBe(200);
    const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updated.onHand).toBe(3);
  });

  it("refuses a correction that would push onHand below held, with 409", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const variant = await makeVariant(2);
    await hold(prisma, { variantId: variant.id, qty: 2 });

    const response = await POST(jsonRequest({ variantId: variant.id, delta: -1 }));

    expect(response.status).toBe(409);
  });

  it("rejects a malformed body with 400", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());

    const response = await POST(jsonRequest({ variantId: 123, delta: "x" }));

    expect(response.status).toBe(400);
  });
});
