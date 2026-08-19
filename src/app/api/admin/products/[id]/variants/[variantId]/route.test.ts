import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";
import { createProduct } from "@/modules/catalog/product.service";

// HTTP-level tests for the admin variant edit/delete route — thin wiring
// over src/modules/catalog/product.service.ts's updateVariant()/
// deleteVariant() (design.md F4-F8). Mirrors
// api/admin/categories/[id]/route.test.ts's and
// api/admin/products/[id]/route.test.ts's conventions: mocked auth() + real
// Postgres, one seeded product+variant per test. Backs
// specs/admin-console/spec.md "Authenticated Access" and "Product and
// Variant Management". tasks.md 3.1/3.2.
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { PATCH, DELETE } = await import("./route");

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/products/x/variants/y", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function invalidJsonPatchRequest(): Request {
  return new Request("http://localhost/api/admin/products/x/variants/y", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
}

function deleteRequest(): Request {
  return new Request("http://localhost/api/admin/products/x/variants/y", { method: "DELETE" });
}

function ctx(id: string, variantId: string) {
  return { params: Promise.resolve({ id, variantId }) };
}

describe("PATCH/DELETE /api/admin/products/[id]/variants/[variantId] (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makeCategory(namePrefix: string) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `${namePrefix} ${suffix}`, slug: `${namePrefix.toLowerCase()}-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    return category;
  }

  async function makeProductWithVariants(
    namePrefix: string,
    categoryId: string,
    variants: Array<{ size: string; color: string; onHand?: number }>,
  ) {
    const suffix = randomUUID();
    const product = await createProduct(prisma, {
      name: `${namePrefix} ${suffix}`,
      slug: `${namePrefix.toLowerCase()}-${suffix}`,
      price: 20000,
      categoryId,
      variants: variants.map((v, i) => ({
        size: v.size,
        color: v.color,
        sku: `${namePrefix.toUpperCase()}-${i}-${suffix}`,
        onHand: v.onHand ?? 0,
      })),
    });
    createdProductIds.push(product.id);
    return product;
  }

  describe("PATCH", () => {
    it("returns 200 with { id, sku, size, color }", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Variant Rename");
      const product = await makeProductWithVariants("Variant Rename", category.id, [
        { size: "M", color: "Negro" },
      ]);
      const variant = product.variants[0];
      const newSku = `NEWSKU-${randomUUID()}`;

      const response = await PATCH(patchRequest({ sku: newSku }), ctx(product.id, variant.id));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ id: variant.id, sku: newSku, size: "M", color: "Negro" });
    });

    it("returns 400 invalid_request for unparseable JSON", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Bad Json Variant");
      const product = await makeProductWithVariants("Bad Json Variant", category.id, [
        { size: "M", color: "Negro" },
      ]);
      const variant = product.variants[0];

      const response = await PATCH(invalidJsonPatchRequest(), ctx(product.id, variant.id));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 invalid_request when no writable key is present", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("No Key Variant");
      const product = await makeProductWithVariants("No Key Variant", category.id, [
        { size: "M", color: "Negro" },
      ]);
      const variant = product.variants[0];

      const response = await PATCH(patchRequest({}), ctx(product.id, variant.id));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 invalid_request when a provided value is empty after trim", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Empty Value Variant");
      const product = await makeProductWithVariants("Empty Value Variant", category.id, [
        { size: "M", color: "Negro" },
      ]);
      const variant = product.variants[0];

      const response = await PATCH(patchRequest({ sku: "   " }), ctx(product.id, variant.id));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 stock_not_editable when the body carries an onHand key, and mutates nothing", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Stock Guard");
      const product = await makeProductWithVariants("Stock Guard", category.id, [
        { size: "M", color: "Negro", onHand: 3 },
      ]);
      const variant = product.variants[0];

      const response = await PATCH(
        patchRequest({ sku: "New-Sku", onHand: 99 }),
        ctx(product.id, variant.id),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("stock_not_editable");

      const unchanged = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(unchanged.sku).toBe(variant.sku);
      expect(unchanged.onHand).toBe(3);
    });

    it("returns 400 stock_not_editable when the body carries a held key", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Held Guard");
      const product = await makeProductWithVariants("Held Guard", category.id, [
        { size: "M", color: "Negro" },
      ]);
      const variant = product.variants[0];

      const response = await PATCH(patchRequest({ held: 1 }), ctx(product.id, variant.id));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("stock_not_editable");
    });

    it("returns 401 with no session and mutates nothing", async () => {
      mockedAuth.mockResolvedValueOnce(null);
      const category = await makeCategory("No Auth Variant");
      const product = await makeProductWithVariants("No Auth Variant", category.id, [
        { size: "M", color: "Negro" },
      ]);
      const variant = product.variants[0];

      const response = await PATCH(
        patchRequest({ sku: "Intento-Sin-Auth" }),
        ctx(product.id, variant.id),
      );

      expect(response.status).toBe(401);
      const unchanged = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(unchanged.sku).toBe(variant.sku);
    });

    it("returns 404 variant_not_found for an unknown variant id", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Unknown Variant");
      const product = await makeProductWithVariants("Unknown Variant", category.id, [
        { size: "M", color: "Negro" },
      ]);

      const response = await PATCH(
        patchRequest({ sku: "no-existe" }),
        ctx(product.id, `does-not-exist-${randomUUID()}`),
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("variant_not_found");
    });

    it("returns 409 duplicate_sku on a sku collision", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Dup Sku Variant");
      const product = await makeProductWithVariants("Dup Sku Variant", category.id, [
        { size: "S", color: "Negro" },
        { size: "M", color: "Negro" },
      ]);
      const [variantA, variantB] = product.variants;

      const response = await PATCH(
        patchRequest({ sku: variantB.sku }),
        ctx(product.id, variantA.id),
      );

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("duplicate_sku");
    });

    it("returns 409 duplicate_variant when the resolved pair collides", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Dup Pair Variant");
      const product = await makeProductWithVariants("Dup Pair Variant", category.id, [
        { size: "S", color: "Negro" },
        { size: "M", color: "Negro" },
      ]);
      const [variantA] = product.variants;

      const response = await PATCH(patchRequest({ size: "M" }), ctx(product.id, variantA.id));

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("duplicate_variant");
    });

    it("returns 409 variant_attributes_immutable with orderItemCount when size/color is sent on a variant with order history, and confirms an sku-only PATCH still succeeds", async () => {
      const category = await makeCategory("Immutable Variant");
      const product = await makeProductWithVariants("Immutable Variant", category.id, [
        { size: "S", color: "Negro" },
      ]);
      const variant = product.variants[0];
      const suffix = randomUUID();

      const order = await prisma.order.create({
        data: {
          publicCode: `RTIMMUT-${suffix}`,
          buyerName: "Compradora Route Immut",
          phone: "3800000003",
          email: "route-immut@example.com",
          method: "PICKUP_CASH",
          status: "PAID",
          items: { create: [{ variantId: variant.id, qty: 1, unitPrice: 20000 }] },
        },
      });

      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const blockedResponse = await PATCH(
        patchRequest({ color: "Blanco" }),
        ctx(product.id, variant.id),
      );
      expect(blockedResponse.status).toBe(409);
      const blockedBody = await blockedResponse.json();
      expect(blockedBody.error).toBe("variant_attributes_immutable");
      expect(blockedBody.orderItemCount).toBe(1);

      const newSku = `IMMUT-ROUTE-${suffix}`;
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const okResponse = await PATCH(patchRequest({ sku: newSku }), ctx(product.id, variant.id));
      expect(okResponse.status).toBe(200);
      const okBody = await okResponse.json();
      expect(okBody.sku).toBe(newSku);

      await prisma.order.delete({ where: { id: order.id } });
    });
  });

  describe("DELETE", () => {
    it("returns 200 { id } on a clean non-last variant, and the product remains", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Delete Clean Variant");
      const product = await makeProductWithVariants("Delete Clean Variant", category.id, [
        { size: "S", color: "Negro" },
        { size: "M", color: "Negro" },
      ]);
      const [toDelete] = product.variants;

      const response = await DELETE(deleteRequest(), ctx(product.id, toDelete.id));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ id: toDelete.id });

      expect(await prisma.variant.findUnique({ where: { id: toDelete.id } })).toBeNull();
      expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
    });

    it("returns 401 with no session and deletes nothing", async () => {
      mockedAuth.mockResolvedValueOnce(null);
      const category = await makeCategory("No Auth Delete Variant");
      const product = await makeProductWithVariants("No Auth Delete Variant", category.id, [
        { size: "S", color: "Negro" },
        { size: "M", color: "Negro" },
      ]);
      const [target] = product.variants;

      const response = await DELETE(deleteRequest(), ctx(product.id, target.id));

      expect(response.status).toBe(401);
      expect(await prisma.variant.findUnique({ where: { id: target.id } })).not.toBeNull();
    });

    it("returns 404 variant_not_found for an unknown variant id", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Unknown Delete Variant");
      const product = await makeProductWithVariants("Unknown Delete Variant", category.id, [
        { size: "M", color: "Negro" },
      ]);

      const response = await DELETE(
        deleteRequest(),
        ctx(product.id, `does-not-exist-${randomUUID()}`),
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("variant_not_found");
    });

    it("returns 409 last_variant when it is the product's only variant", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Last Variant");
      const product = await makeProductWithVariants("Last Variant", category.id, [
        { size: "U", color: "Unico" },
      ]);
      const [only] = product.variants;

      const response = await DELETE(deleteRequest(), ctx(product.id, only.id));

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("last_variant");
    });

    it("returns 409 variant_has_stock with onHand when onHand > 0", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Stock Variant Delete");
      const product = await makeProductWithVariants("Stock Variant Delete", category.id, [
        { size: "S", color: "Negro", onHand: 4 },
        { size: "M", color: "Negro" },
      ]);
      const stocked = product.variants.find((v) => v.onHand > 0)!;

      const response = await DELETE(deleteRequest(), ctx(product.id, stocked.id));

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("variant_has_stock");
      expect(body.onHand).toBe(4);
    });

    it("returns 409 variant_has_history with both counts when the variant has order/stock history", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("History Variant Delete");
      const product = await makeProductWithVariants("History Variant Delete", category.id, [
        { size: "S", color: "Negro" },
        { size: "M", color: "Negro" },
      ]);
      const [target] = product.variants;

      await prisma.stockMovement.create({
        data: { variantId: target.id, delta: 1, reason: "ADJUSTMENT" },
      });

      const response = await DELETE(deleteRequest(), ctx(product.id, target.id));

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("variant_has_history");
      expect(body.orderItemCount).toBe(0);
      expect(body.stockMovementCount).toBe(1);

      await prisma.stockMovement.deleteMany({ where: { variantId: target.id } });
    });
  });
});
