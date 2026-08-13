import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";

// HTTP-level tests for the admin product-creation route — thin wiring over
// src/modules/catalog/product.service.ts's createProduct() (design.md D1:
// business logic lives in the module, not duplicated in the route). Backs
// specs/admin-console/spec.md "Product and Variant Management" ("owner adds
// a product unaided": variants + stock + images in one save) AND
// "Authenticated Access" (this route is NOT covered by middleware.ts's
// matcher — /api/admin/* is deliberately excluded, see middleware.ts's
// module doc — so it MUST check the session itself). tasks.md 7.1/7.3.
//
// `@/lib/auth`'s `auth()` is mocked (same pattern as
// app/api/webhooks/mercadopago/route.test.ts mocking the MP SDK boundary) —
// this test proves the route's OWN authorization check, independent of
// next-auth's session-cookie machinery (already proven end-to-end by
// e2e/admin-auth.spec.ts).
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { POST } = await import("./route");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/products", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/products (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makeCategory() {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Admin Route Test ${suffix}`, slug: `admin-route-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    return category;
  }

  it("rejects an unauthenticated request with 401 and writes nothing to the DB (Authenticated Access)", async () => {
    mockedAuth.mockResolvedValueOnce(null);
    const category = await makeCategory();
    const suffix = randomUUID();

    const response = await POST(
      jsonRequest({
        name: "No Auth Product",
        slug: `no-auth-${suffix}`,
        price: 10000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Unico", sku: `NOAUTH-${suffix}`, onHand: 1 }],
      }),
    );

    expect(response.status).toBe(401);
    const found = await prisma.product.findUnique({ where: { slug: `no-auth-${suffix}` } });
    expect(found).toBeNull();
  });

  it("creates a product with variants, stock, and images in one save for an authenticated staff session", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory();
    const suffix = randomUUID();

    const response = await POST(
      jsonRequest({
        name: "Vestido Admin",
        slug: `vestido-admin-${suffix}`,
        price: 32000,
        categoryId: category.id,
        variants: [
          { size: "S", color: "Negro", sku: `VADM-S-${suffix}`, onHand: 2 },
          { size: "M", color: "Negro", sku: `VADM-M-${suffix}`, onHand: 5 },
        ],
        images: [{ url: "/uploads/admin-test.jpg", altText: "Vestido Admin" }],
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    createdProductIds.push(body.id);

    const saved = await prisma.product.findUnique({
      where: { id: body.id },
      include: { variants: true, images: true },
    });
    expect(saved?.variants).toHaveLength(2);
    expect(saved?.images).toHaveLength(1);
  });

  it("rejects a malformed body with 400 (missing required fields)", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());

    const response = await POST(jsonRequest({ name: "Incomplete" }));

    expect(response.status).toBe(400);
  });
});
