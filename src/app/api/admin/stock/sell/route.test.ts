import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";
import { createProduct } from "@/modules/catalog/product.service";
import { hold } from "@/modules/inventory/stock.service";

// HTTP-level tests for the in-store sale route — thin wiring over
// stock.service.ts's sellInStore() (design.md D1). Backs
// specs/inventory-stock/spec.md "In-store sale reduces online-visible
// stock" and specs/admin-console/spec.md "Authenticated Access". tasks.md
// 7.1/7.7.
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { POST } = await import("./route");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/stock/sell", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/stock/sell (integration, real Postgres)", () => {
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
      data: { name: `Sell Route Test ${suffix}`, slug: `sell-route-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    const product = await createProduct(prisma, {
      name: `Producto Sell ${suffix}`,
      slug: `producto-sell-${suffix}`,
      price: 15000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `SELL-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);
    return product.variants[0];
  }

  it("rejects an unauthenticated request with 401 and changes nothing", async () => {
    mockedAuth.mockResolvedValueOnce(null);
    const variant = await makeVariant(3);

    const response = await POST(jsonRequest({ variantId: variant.id, qty: 1 }));

    expect(response.status).toBe(401);
    const unchanged = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(unchanged.onHand).toBe(3);
  });

  it("decrements onHand for an authenticated in-store sale (spec: reflected immediately online)", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const variant = await makeVariant(5);

    const response = await POST(jsonRequest({ variantId: variant.id, qty: 2 }));

    expect(response.status).toBe(200);
    const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updated.onHand).toBe(3);
  });

    it("refuses to sell a held (reserved-unpaid) unit with 409, matching the HARD RULE", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const variant = await makeVariant(1);
    await hold(prisma, { variantId: variant.id, qty: 1 });

    const response = await POST(jsonRequest({ variantId: variant.id, qty: 1 }));

    expect(response.status).toBe(409);
  });

  it("rejects a malformed body with 400", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());

    const response = await POST(jsonRequest({ variantId: 123, qty: "two" }));

    expect(response.status).toBe(400);
  });
});
