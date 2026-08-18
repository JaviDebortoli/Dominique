import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";
import { createProduct } from "@/modules/catalog/product.service";

// HTTP-level tests for the admin category edit/delete route — thin wiring
// over src/modules/catalog/category.service.ts's renameCategory()/
// deleteCategory() (design.md E1-E5). Mirrors
// api/admin/orders/[orderId]/pickup/route.test.ts and
// api/admin/categories/route.test.ts's conventions: mocked auth() + real
// Postgres, one seeded category per test. Backs specs/admin-console/spec.md
// "Authenticated Access" and "Product and Variant Management". tasks.md
// 2.1/2.2.
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { PATCH, DELETE } = await import("./route");

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/categories/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function invalidJsonPatchRequest(): Request {
  return new Request("http://localhost/api/admin/categories/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
}

function deleteRequest(): Request {
  return new Request("http://localhost/api/admin/categories/x", { method: "DELETE" });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH/DELETE /api/admin/categories/[id] (integration, real Postgres)", () => {
  const createdCategoryIds: string[] = [];
  const createdProductIds: string[] = [];

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

  describe("PATCH", () => {
    it("returns 200 with { id, name, slug } and leaves slug unchanged", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Rename Target");

      const response = await PATCH(patchRequest({ name: "Nuevo Nombre" }), ctx(category.id));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ id: category.id, name: "Nuevo Nombre", slug: category.slug });
    });

    it("returns 400 invalid_request for unparseable JSON", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Bad Json");

      const response = await PATCH(invalidJsonPatchRequest(), ctx(category.id));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 invalid_request for a missing name", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Missing Name");

      const response = await PATCH(patchRequest({}), ctx(category.id));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 invalid_request for an empty (post-trim) name", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Empty Name");

      const response = await PATCH(patchRequest({ name: "   " }), ctx(category.id));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 slug_immutable when the body carries a slug key, even alongside a valid name, and leaves the row untouched", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Slug Guard");

      const response = await PATCH(
        patchRequest({ name: "Nombre Valido", slug: "otra-slug" }),
        ctx(category.id),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("slug_immutable");

      const unchanged = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
      expect(unchanged.name).toBe(category.name);
      expect(unchanged.slug).toBe(category.slug);
    });

    it("returns 401 with no session and mutates nothing", async () => {
      mockedAuth.mockResolvedValueOnce(null);
      const category = await makeCategory("No Auth Patch");

      const response = await PATCH(patchRequest({ name: "Intento Sin Auth" }), ctx(category.id));

      expect(response.status).toBe(401);
      const unchanged = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
      expect(unchanged.name).toBe(category.name);
    });

    it("returns 404 category_not_found for an unknown id", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());

      const response = await PATCH(
        patchRequest({ name: "No Existe" }),
        ctx(`does-not-exist-${randomUUID()}`),
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("category_not_found");
    });

    it("returns 409 duplicate_name with a readable message on a case-insensitive collision, mutating nothing", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const suffix = randomUUID();
      const existing = await prisma.category.create({
        data: { name: `vestidos-${suffix}`, slug: `vestidos-${suffix}` },
      });
      createdCategoryIds.push(existing.id);
      const target = await makeCategory("Accesorios Dup");

      const response = await PATCH(
        patchRequest({ name: `VESTIDOS-${suffix}` }),
        ctx(target.id),
      );

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("duplicate_name");
      expect(typeof body.message).toBe("string");
      expect(body.message.length).toBeGreaterThan(0);

      const unchanged = await prisma.category.findUniqueOrThrow({ where: { id: target.id } });
      expect(unchanged.name).toBe(target.name);
    });
  });

  describe("DELETE", () => {
    it("returns 200 { id } on an empty category and removes the row", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Delete Empty");

      const response = await DELETE(deleteRequest(), ctx(category.id));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ id: category.id });

      const found = await prisma.category.findUnique({ where: { id: category.id } });
      expect(found).toBeNull();
    });

    it("returns 401 with no session and deletes nothing", async () => {
      mockedAuth.mockResolvedValueOnce(null);
      const category = await makeCategory("No Auth Delete");

      const response = await DELETE(deleteRequest(), ctx(category.id));

      expect(response.status).toBe(401);
      const stillThere = await prisma.category.findUnique({ where: { id: category.id } });
      expect(stillThere).not.toBeNull();
    });

    it("returns 404 category_not_found for an unknown id", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());

      const response = await DELETE(deleteRequest(), ctx(`does-not-exist-${randomUUID()}`));

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("category_not_found");
    });

    it("returns 409 category_has_products with productCount when products reference the category, and the category still exists after", async () => {
      mockedAuth.mockResolvedValueOnce(fakeAdminSession());
      const category = await makeCategory("Delete Blocked");
      const productSuffix = randomUUID();
      const product = await createProduct(prisma, {
        name: `Producto Delete Blocked ${productSuffix}`,
        slug: `producto-delete-blocked-${productSuffix}`,
        price: 20000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Unico", sku: `DELBLK-${productSuffix}`, onHand: 1 }],
      });
      createdProductIds.push(product.id);

      const response = await DELETE(deleteRequest(), ctx(category.id));

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("category_has_products");
      expect(body.productCount).toBe(1);
      expect(typeof body.message).toBe("string");

      const stillThere = await prisma.category.findUnique({ where: { id: category.id } });
      expect(stillThere).not.toBeNull();
    });
  });
});
