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
const { POST, PATCH } = await import("./route");

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

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/products/x/images", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
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

describe("PATCH /api/admin/products/[id]/images — reorder (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makeProductWith3Images() {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Reorder ${suffix}`, slug: `reorder-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    const product = await createProduct(prisma, {
      name: `Reorder ${suffix}`,
      slug: `reorder-${suffix}`,
      price: 20000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Negro", sku: `REORD-${suffix}`, onHand: 0 }],
      images: [
        { url: `/uploads/r0-${suffix}.jpg`, position: 0 },
        { url: `/uploads/r1-${suffix}.jpg`, position: 1 },
        { url: `/uploads/r2-${suffix}.jpg`, position: 2 },
      ],
    });
    createdProductIds.push(product.id);
    return product;
  }

  it("returns 200 with the reordered images and persists the new positions", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const product = await makeProductWith3Images();
    const [a, b, c] = product.images;

    const response = await PATCH(patchRequest({ order: [c.id, a.id, b.id] }), ctx(product.id));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.images.map((image: { id: string }) => image.id)).toEqual([c.id, a.id, b.id]);
    expect(body.images.map((image: { position: number }) => image.position)).toEqual([0, 1, 2]);

    const reread = await prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { position: "asc" },
    });
    expect(reread.map((image) => image.id)).toEqual([c.id, a.id, b.id]);
  });

  it("returns 400 invalid_request when order is missing or not an array of non-empty strings", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const r1 = await PATCH(patchRequest({ order: "not-an-array" }), ctx("x"));
    expect(r1.status).toBe(400);

    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const r2 = await PATCH(patchRequest({ order: ["ok", ""] }), ctx("x"));
    expect(r2.status).toBe(400);

    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const r3 = await PATCH(patchRequest("{not json"), ctx("x"));
    expect(r3.status).toBe(400);
  });

  it("returns 401 with no session and mutates nothing", async () => {
    const product = await makeProductWith3Images();
    const [a, b, c] = product.images;
    mockedAuth.mockResolvedValueOnce(null);

    const response = await PATCH(patchRequest({ order: [c.id, b.id, a.id] }), ctx(product.id));

    expect(response.status).toBe(401);
    const reread = await prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { position: "asc" },
    });
    expect(reread.map((image) => image.id)).toEqual([a.id, b.id, c.id]);
  });

  it("returns 404 product_not_found for an unknown product id", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const response = await PATCH(
      patchRequest({ order: [`img-${randomUUID()}`] }),
      ctx(`does-not-exist-${randomUUID()}`),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("product_not_found");
  });

  it("returns 409 image_order_mismatch when the id set does not match the product's images", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const product = await makeProductWith3Images();
    const [a, b] = product.images;

    const response = await PATCH(patchRequest({ order: [a.id, b.id] }), ctx(product.id));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("image_order_mismatch");
    const untouched = await prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { position: "asc" },
    });
    expect(untouched.map((image) => image.position)).toEqual([0, 1, 2]);
  });
});
