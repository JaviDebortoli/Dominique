import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";
import { createProduct } from "@/modules/catalog/product.service";

// HTTP-level tests for the admin delete-image route — thin wiring over
// src/modules/catalog/product.service.ts's deleteImage() (design.md G4).
// Mirrors api/admin/products/[id]/variants/[variantId]/route.test.ts's
// DELETE conventions: mocked auth() + real Postgres. Backs
// specs/admin-console/spec.md "Owner deletes an image, including the last
// remaining one". tasks.md 6.3/6.4.
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { DELETE } = await import("./route");

function deleteRequest(): Request {
  return new Request("http://localhost/api/admin/products/x/images/y", { method: "DELETE" });
}

function ctx(id: string, imageId: string) {
  return { params: Promise.resolve({ id, imageId }) };
}

describe("DELETE /api/admin/products/[id]/images/[imageId] (integration, real Postgres)", () => {
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

  it("returns 200 { id } and removes the image", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Delete Image Happy");
    const product = await makeProductWithImages("Delete Image Happy", category.id, 2);
    const [imageToDelete] = product.images;

    const response = await DELETE(deleteRequest(), ctx(product.id, imageToDelete.id));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ id: imageToDelete.id });

    const found = await prisma.productImage.findUnique({ where: { id: imageToDelete.id } });
    expect(found).toBeNull();
  });

  it("returns 200 when deleting the product's LAST image, and the product row still exists (G4)", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Delete Last Image");
    const product = await makeProductWithImages("Delete Last Image", category.id, 1);
    const [onlyImage] = product.images;

    const response = await DELETE(deleteRequest(), ctx(product.id, onlyImage.id));

    expect(response.status).toBe(200);
    const stillExists = await prisma.product.findUnique({ where: { id: product.id } });
    expect(stillExists).not.toBeNull();
    const remainingImages = await prisma.productImage.count({ where: { productId: product.id } });
    expect(remainingImages).toBe(0);
  });

  it("returns 401 with no session and mutates nothing", async () => {
    mockedAuth.mockResolvedValueOnce(null);
    const category = await makeCategory("No Auth Delete Image");
    const product = await makeProductWithImages("No Auth Delete Image", category.id, 1);
    const [image] = product.images;

    const response = await DELETE(deleteRequest(), ctx(product.id, image.id));

    expect(response.status).toBe(401);
    const found = await prisma.productImage.findUnique({ where: { id: image.id } });
    expect(found).not.toBeNull();
  });

  it("returns 404 image_not_found for an unknown imageId", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const category = await makeCategory("Unknown Image");
    const product = await makeProductWithImages("Unknown Image", category.id, 0);

    const response = await DELETE(
      deleteRequest(),
      ctx(product.id, `does-not-exist-${randomUUID()}`),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("image_not_found");
  });
});
