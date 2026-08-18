import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";
import { createProduct } from "@/modules/catalog/product.service";

// HTTP-level tests for the admin product edit/delete route — thin wiring
// over src/modules/catalog/product.service.ts's updateProduct()/
// deleteProduct() (design.md F1-F3). Mirrors
// api/admin/categories/[id]/route.test.ts's conventions: mocked auth() +
// real Postgres, one seeded product per test. Backs
// specs/admin-console/spec.md "Authenticated Access" and "Product and
// Variant Management". tasks.md 2.1/2.2.
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { PATCH, DELETE } = await import("./route");

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/products/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function invalidJsonPatchRequest(): Request {
  return new Request("http://localhost/api/admin/products/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
}

function deleteRequest(): Request {
  return new Request("http://localhost/api/admin/products/x", { method: "DELETE" });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH/DELETE /api/admin/products/[id] (integration, real Postgres)", () => {
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

  async function makeProduct(namePrefix: string, categoryId: string, onHand = 0) {
    const suffix = randomUUID();
    const product = await createProduct(prisma, {
      name: `${namePrefix} ${suffix}`,
      slug: `${namePrefix.toLowerCase()}-${suffix}`,
      price: 20000,
      categoryId,
      variants: [{ size: "M", color: "Negro", sku: `${namePrefix.toUpperCase()}-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);
    return product;
  }

  describe("PATCH", () => {
    it("returns 200 with { id, name, slug, description, price, categoryId } and leaves slug unchanged", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Rename Target");
      const product = await makeProduct("Rename Target", category.id);

      const response = await PATCH(
        patchRequest({ name: "Nuevo Nombre", price: 25000 }),
        ctx(product.id),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        id: product.id,
        name: "Nuevo Nombre",
        slug: product.slug,
        description: product.description,
        price: 25000,
        categoryId: category.id,
      });
    });

    it("returns 400 invalid_request for unparseable JSON", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Bad Json");
      const product = await makeProduct("Bad Json", category.id);

      const response = await PATCH(invalidJsonPatchRequest(), ctx(product.id));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 invalid_request when no writable key is present", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("No Key");
      const product = await makeProduct("No Key", category.id);

      const response = await PATCH(patchRequest({}), ctx(product.id));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 invalid_request for an empty (post-trim) name", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Empty Name");
      const product = await makeProduct("Empty Name", category.id);

      const response = await PATCH(patchRequest({ name: "   " }), ctx(product.id));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 invalid_request for a non-finite/negative price", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Bad Price");
      const product = await makeProduct("Bad Price", category.id);

      const response = await PATCH(patchRequest({ price: -5 }), ctx(product.id));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 invalid_request when description is neither a string nor null", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Bad Description");
      const product = await makeProduct("Bad Description", category.id);

      const response = await PATCH(patchRequest({ description: 123 }), ctx(product.id));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 invalid_request for an empty categoryId", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Empty Category");
      const product = await makeProduct("Empty Category", category.id);

      const response = await PATCH(patchRequest({ categoryId: "   " }), ctx(product.id));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 slug_immutable when the body carries a slug key at all, and leaves the row untouched", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Slug Guard");
      const product = await makeProduct("Slug Guard", category.id);

      const response = await PATCH(
        patchRequest({ name: "Nombre Valido", slug: "otra-slug" }),
        ctx(product.id),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("slug_immutable");

      const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(unchanged.name).toBe(product.name);
      expect(unchanged.slug).toBe(product.slug);
    });

    it("returns 400 invalid_category for an unknown categoryId", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Unknown Category");
      const product = await makeProduct("Unknown Category", category.id);

      const response = await PATCH(
        patchRequest({ categoryId: `nope-${randomUUID()}` }),
        ctx(product.id),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_category");
    });

    it("returns 401 with no session and mutates nothing", async () => {
      mockedAuth.mockResolvedValueOnce(null);
      const category = await makeCategory("No Auth Patch");
      const product = await makeProduct("No Auth Patch", category.id);

      const response = await PATCH(patchRequest({ name: "Intento Sin Auth" }), ctx(product.id));

      expect(response.status).toBe(401);
      const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(unchanged.name).toBe(product.name);
    });

    it("returns 404 product_not_found for an unknown id", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());

      const response = await PATCH(
        patchRequest({ name: "No Existe" }),
        ctx(`does-not-exist-${randomUUID()}`),
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("product_not_found");
    });
  });

  describe("DELETE", () => {
    it("returns 200 { id } on a clean product and removes the row (variants + images cascaded)", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Delete Clean");
      const product = await makeProduct("Delete Clean", category.id, 0);

      const response = await DELETE(deleteRequest(), ctx(product.id));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ id: product.id });

      const found = await prisma.product.findUnique({ where: { id: product.id } });
      expect(found).toBeNull();
    });

    it("returns 401 with no session and deletes nothing", async () => {
      mockedAuth.mockResolvedValueOnce(null);
      const category = await makeCategory("No Auth Delete");
      const product = await makeProduct("No Auth Delete", category.id);

      const response = await DELETE(deleteRequest(), ctx(product.id));

      expect(response.status).toBe(401);
      const stillThere = await prisma.product.findUnique({ where: { id: product.id } });
      expect(stillThere).not.toBeNull();
    });

    it("returns 404 product_not_found for an unknown id", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());

      const response = await DELETE(deleteRequest(), ctx(`does-not-exist-${randomUUID()}`));

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("product_not_found");
    });

    it("returns 409 product_has_stock with skus in the body when a variant has onHand > 0", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Delete Stock");
      const product = await makeProduct("Delete Stock", category.id, 5);
      const sku = product.variants[0].sku;

      const response = await DELETE(deleteRequest(), ctx(product.id));

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("product_has_stock");
      expect(body.skus).toEqual([sku]);

      const stillThere = await prisma.product.findUnique({ where: { id: product.id } });
      expect(stillThere).not.toBeNull();
    });

    it("returns 409 product_has_history with orderItemCount+stockMovementCount when a variant has an OrderItem, and the product still exists after", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Delete History");
      const product = await makeProduct("Delete History", category.id, 0);
      const variant = product.variants[0];
      const suffix = randomUUID();

      const order = await prisma.order.create({
        data: {
          publicCode: `RTHIST-${suffix}`,
          buyerName: "Compradora Route Test",
          phone: "3800000002",
          email: "route-test@example.com",
          method: "PICKUP_CASH",
          status: "PAID",
          items: { create: [{ variantId: variant.id, qty: 1, unitPrice: 20000 }] },
        },
      });
      await prisma.stockMovement.create({
        data: { variantId: variant.id, delta: 1, reason: "PAID", orderId: order.id },
      });

      const response = await DELETE(deleteRequest(), ctx(product.id));

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("product_has_history");
      expect(body.orderItemCount).toBe(1);
      expect(body.stockMovementCount).toBe(1);

      const stillThere = await prisma.product.findUnique({ where: { id: product.id } });
      expect(stillThere).not.toBeNull();

      // Unblock afterAll's cleanup.
      await prisma.stockMovement.deleteMany({ where: { orderId: order.id } });
      await prisma.order.delete({ where: { id: order.id } });
    });
  });
});
