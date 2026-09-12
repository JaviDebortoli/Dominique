import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";
import { createProduct } from "@/modules/catalog/product.service";
import { recordInStoreSale } from "@/modules/sales/sale.service";

// HTTP-level tests for the staff "Anular" action — thin wiring over
// sale.service.ts's voidSale() (design.md D1, tasks.md Phase 3's
// already-tested service logic). Backs specs/sales-revenue/spec.md "Sale
// Voiding (Anular)" and specs/admin-console/spec.md "Authenticated Access".
// control-de-caja tasks.md 3.6/3.7.
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { POST } = await import("./route");

function request(): Request {
  return new Request("http://localhost/api/admin/sales/x/void", { method: "POST" });
}

function ctx(saleId: string) {
  return { params: Promise.resolve({ saleId }) };
}

describe("POST /api/admin/sales/[saleId]/void (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.sale.deleteMany({ where: { variant: { productId: { in: createdProductIds } } } });
    await prisma.stockMovement.deleteMany({
      where: { variant: { productId: { in: createdProductIds } } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makeSale(onHand: number, qty = 1, soldAt?: Date) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Void Route Test ${suffix}`, slug: `void-route-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    const product = await createProduct(prisma, {
      name: `Producto Void Route ${suffix}`,
      slug: `producto-void-route-${suffix}`,
      price: 12000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `VOIDR-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);
    const variant = product.variants[0]!;

    const sale = await recordInStoreSale(prisma, {
      variantId: variant.id,
      qty,
      paymentMethod: "CASH",
    });
    if (soldAt) {
      await prisma.sale.update({ where: { id: sale.id }, data: { soldAt } });
    }
    return { sale, variant };
  }

  it("rejects an unauthenticated request with 401 and leaves the sale untouched", async () => {
    mockedAuth.mockResolvedValueOnce(null);
    const { sale } = await makeSale(5);

    const response = await POST(request(), ctx(sale.id));

    expect(response.status).toBe(401);
    const unchanged = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(unchanged.voidedAt).toBeNull();
  });

  it("voids the sale and restocks for an authenticated staff session", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const { sale, variant } = await makeSale(5, 2);

    const response = await POST(request(), ctx(sale.id));

    expect(response.status).toBe(200);
    const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updatedVariant.onHand).toBe(5);
  });

  it("returns 404 sale_not_found for an unknown saleId", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());

    const response = await POST(request(), ctx(`does-not-exist-${randomUUID()}`));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("sale_not_found");
  });

  it("returns 409 already_voided for a sale voided twice", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const { sale } = await makeSale(3);
    await POST(request(), ctx(sale.id));

    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const response = await POST(request(), ctx(sale.id));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("already_voided");
  });

  it("returns 409 void_window_closed for a sale sold yesterday", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { sale } = await makeSale(4, 1, yesterday);

    const response = await POST(request(), ctx(sale.id));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("void_window_closed");
  });
});
