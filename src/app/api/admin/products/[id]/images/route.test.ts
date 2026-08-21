import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";
import { createProduct } from "@/modules/catalog/product.service";

// HTTP-level tests for the admin add-image route — thin wiring over
// src/modules/catalog/product.service.ts's addImage() (design.md G1-G3).
// Mirrors api/admin/products/[id]/variants/route.test.ts's conventions:
// mocked auth() + real Postgres, one seeded product per test. Backs
// specs/admin-console/spec.md "Owner adds an image to an existing product"
// and "Adding a 6th image is rejected". tasks.md 6.1/6.2.
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { POST } = await import("./route");

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/products/x/images", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function invalidJsonPostRequest(): Request {
  return new Request("http://localhost/api/admin/products/x/images", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/products/[id]/images (integration, real Postgres)", () => {
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

  async function makeProductWithImages(
    namePrefix: string,
    categoryId: string,
    imageCount: number,
  ) {
    const suffix = randomUUID();
    const product = await createProduct(prisma, {
      name: `${namePrefix} ${suffix}`,
      slug: `${namePrefix.toLowerCase()}-${suffix}`,
      price: 20000,
      categoryId,
      variants: [{ size: "U", color: "Negro", sku: `${namePrefix.toUpperCase()}-${suffix}`, onHand: 0 }],
      images: Array.from({ length: imageCount }, (_, i) => ({
        url: `/uploads/${namePrefix.toLowerCase()}-${i}-${suffix}.jpg`,
        position: i,
      })),
    });
    createdProductIds.push(product.id);
    return product;
  }

  it("returns 201 { id, url, altText, position } when attached", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Add Image Happy");
    const product = await makeProductWithImages("Add Image Happy", category.id, 0);

    const response = await POST(
      postRequest({ url: "/uploads/new-image.jpg", altText: "Vestido" }),
      ctx(product.id),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      id: expect.any(String),
      url: "/uploads/new-image.jpg",
      altText: "Vestido",
      position: 0,
    });

    const created = await prisma.productImage.findUniqueOrThrow({ where: { id: body.id } });
    expect(created.url).toBe("/uploads/new-image.jpg");
  });

  it("returns 400 invalid_request for unparseable JSON", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Bad Json Add Image");
    const product = await makeProductWithImages("Bad Json Add Image", category.id, 0);

    const response = await POST(invalidJsonPostRequest(), ctx(product.id));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  it("returns 400 invalid_request when url is empty after trim", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Empty Url");
    const product = await makeProductWithImages("Empty Url", category.id, 0);

    const response = await POST(postRequest({ url: "   " }), ctx(product.id));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  it("returns 400 invalid_request when position is present and not a finite integer >= 0", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Bad Position");
    const product = await makeProductWithImages("Bad Position", category.id, 0);

    const response = await POST(
      postRequest({ url: "/uploads/x.jpg", position: -1 }),
      ctx(product.id),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  it("returns 401 with no session and mutates nothing", async () => {
    mockedAuth.mockResolvedValueOnce(null);
    const category = await makeCategory("No Auth Add Image");
    const product = await makeProductWithImages("No Auth Add Image", category.id, 0);
    const countBefore = await prisma.productImage.count({ where: { productId: product.id } });

    const response = await POST(postRequest({ url: "/uploads/x.jpg" }), ctx(product.id));

    expect(response.status).toBe(401);
    const countAfter = await prisma.productImage.count({ where: { productId: product.id } });
    expect(countAfter).toBe(countBefore);
  });

  it("returns 404 product_not_found for an unknown product id", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());

    const response = await POST(
      postRequest({ url: "/uploads/x.jpg" }),
      ctx(`does-not-exist-${randomUUID()}`),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("product_not_found");
  });

  it("returns 409 too_many_images with currentCount when the product already has 5 images", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Too Many Images");
    const product = await makeProductWithImages("Too Many Images", category.id, 5);

    const response = await POST(postRequest({ url: "/uploads/sixth.jpg" }), ctx(product.id));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("too_many_images");
    expect(body.currentCount).toBe(5);

    const countAfter = await prisma.productImage.count({ where: { productId: product.id } });
    expect(countAfter).toBe(5);
  });
});
