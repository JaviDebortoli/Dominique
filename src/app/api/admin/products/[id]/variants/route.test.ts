import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";
import { createProduct } from "@/modules/catalog/product.service";

// HTTP-level tests for the admin add-variant route — thin wiring over
// src/modules/catalog/product.service.ts's UNMODIFIED addVariant() (design.md
// G5/G6). Mirrors api/admin/products/[id]/variants/[variantId]/route.test.ts's
// conventions: mocked auth() + real Postgres, one seeded product (+ optional
// existing variant) per test. Backs specs/admin-console/spec.md "Owner adds a
// variant to an existing product" and "Adding a duplicate size+color variant
// is rejected". tasks.md 1.1/1.2.
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { POST } = await import("./route");

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/products/x/variants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function invalidJsonPostRequest(): Request {
  return new Request("http://localhost/api/admin/products/x/variants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/products/[id]/variants (integration, real Postgres)", () => {
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

  it("returns 201 { id, sku, size, color } and persists onHand: 0", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Add Variant Happy");
    const product = await makeProductWithVariants("Add Variant Happy", category.id, [
      { size: "M", color: "Beige" },
    ]);
    const sku = `NEW-VARIANT-${randomUUID()}`;

    const response = await POST(
      postRequest({ size: "L", color: "Beige", sku }),
      ctx(product.id),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ id: expect.any(String), sku, size: "L", color: "Beige" });

    const created = await prisma.variant.findUniqueOrThrow({ where: { id: body.id } });
    expect(created.onHand).toBe(0);
  });

  it("returns 400 invalid_request for unparseable JSON", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Bad Json Add Variant");
    const product = await makeProductWithVariants("Bad Json Add Variant", category.id, [
      { size: "M", color: "Beige" },
    ]);

    const response = await POST(invalidJsonPostRequest(), ctx(product.id));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  it("returns 400 invalid_request when size is missing", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Missing Size");
    const product = await makeProductWithVariants("Missing Size", category.id, [
      { size: "M", color: "Beige" },
    ]);

    const response = await POST(
      postRequest({ color: "Beige", sku: `SKU-${randomUUID()}` }),
      ctx(product.id),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  it("returns 400 invalid_request when color is empty after trim", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Empty Color");
    const product = await makeProductWithVariants("Empty Color", category.id, [
      { size: "M", color: "Beige" },
    ]);

    const response = await POST(
      postRequest({ size: "L", color: "   ", sku: `SKU-${randomUUID()}` }),
      ctx(product.id),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  it("returns 400 invalid_request when sku is missing", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Missing Sku");
    const product = await makeProductWithVariants("Missing Sku", category.id, [
      { size: "M", color: "Beige" },
    ]);

    const response = await POST(postRequest({ size: "L", color: "Beige" }), ctx(product.id));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  it("returns 400 stock_not_editable when the body carries an onHand key, and creates no variant", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Stock Guard Add Variant");
    const product = await makeProductWithVariants("Stock Guard Add Variant", category.id, [
      { size: "M", color: "Beige" },
    ]);
    const countBefore = await prisma.variant.count({ where: { productId: product.id } });

    const response = await POST(
      postRequest({ size: "L", color: "Beige", sku: `SKU-${randomUUID()}`, onHand: 99 }),
      ctx(product.id),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("stock_not_editable");

    const countAfter = await prisma.variant.count({ where: { productId: product.id } });
    expect(countAfter).toBe(countBefore);
  });

  it("returns 400 stock_not_editable when the body carries a held key", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Held Guard Add Variant");
    const product = await makeProductWithVariants("Held Guard Add Variant", category.id, [
      { size: "M", color: "Beige" },
    ]);

    const response = await POST(
      postRequest({ size: "L", color: "Beige", sku: `SKU-${randomUUID()}`, held: 1 }),
      ctx(product.id),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("stock_not_editable");
  });

  it("returns 401 with no session and mutates nothing", async () => {
    mockedAuth.mockResolvedValueOnce(null);
    const category = await makeCategory("No Auth Add Variant");
    const product = await makeProductWithVariants("No Auth Add Variant", category.id, [
      { size: "M", color: "Beige" },
    ]);
    const countBefore = await prisma.variant.count({ where: { productId: product.id } });

    const response = await POST(
      postRequest({ size: "L", color: "Beige", sku: `SKU-${randomUUID()}` }),
      ctx(product.id),
    );

    expect(response.status).toBe(401);
    const countAfter = await prisma.variant.count({ where: { productId: product.id } });
    expect(countAfter).toBe(countBefore);
  });

  it("returns 404 product_not_found for an unknown product id", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());

    const response = await POST(
      postRequest({ size: "L", color: "Beige", sku: `SKU-${randomUUID()}` }),
      ctx(`does-not-exist-${randomUUID()}`),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("product_not_found");
  });

  it("returns 409 duplicate_variant with Spanish copy built from size/color and creates no variant", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Dup Add Variant");
    const product = await makeProductWithVariants("Dup Add Variant", category.id, [
      { size: "M", color: "Negro" },
    ]);
    const countBefore = await prisma.variant.count({ where: { productId: product.id } });

    const response = await POST(
      postRequest({ size: "M", color: "Negro", sku: `SKU-${randomUUID()}` }),
      ctx(product.id),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("duplicate_variant");
    expect(body.message).toBe('Ya existe una variante talle "M" color "Negro". Editá la existente.');

    const countAfter = await prisma.variant.count({ where: { productId: product.id } });
    expect(countAfter).toBe(countBefore);
  });
});
