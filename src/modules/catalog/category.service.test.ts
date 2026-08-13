import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct } from "./product.service";
import {
  getCategoryBySlug,
  listCategoriesWithThumbnail,
  listProductsByCategory,
} from "./category.service";

// Integration tests against the real local Postgres, mirroring
// product.service.test.ts conventions.
describe("category.service (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
    await prisma.$disconnect();
  });

  async function makeCategory(name: string) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name, slug: `${name}-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    return category;
  }

  describe("Category Association — listing filter works", () => {
    it("only lists products assigned to the browsed category", async () => {
      const vestidos = await makeCategory("vestidos-listing");
      const camperas = await makeCategory("camperas-listing");
      const suffix = randomUUID();

      const vestido = await createProduct(prisma, {
        name: "Vestido Fiesta",
        slug: `vestido-fiesta-${suffix}`,
        price: 55000,
        categoryId: vestidos.id,
        variants: [{ size: "M", color: "Rojo", sku: `VF-M-ROJ-${suffix}`, onHand: 2 }],
      });
      createdProductIds.push(vestido.id);

      const campera = await createProduct(prisma, {
        name: "Campera Cuero",
        slug: `campera-cuero-${suffix}`,
        price: 90000,
        categoryId: camperas.id,
        variants: [{ size: "L", color: "Negro", sku: `CC-L-NEG-${suffix}`, onHand: 1 }],
      });
      createdProductIds.push(campera.id);

      const vestidosListing = await listProductsByCategory(prisma, vestidos.slug);
      const vestidosNames = vestidosListing.map((p) => p.name);

      expect(vestidosNames).toContain("Vestido Fiesta");
      expect(vestidosNames).not.toContain("Campera Cuero");
    });

    it("returns an empty list for a category with no products", async () => {
      const empty = await makeCategory("sin-productos");

      const listing = await listProductsByCategory(prisma, empty.slug);

      expect(listing).toEqual([]);
    });

    it("includes price and a thumbnail image per product (storefront-browsing: price + thumbnail)", async () => {
      const category = await makeCategory("accesorios-thumb");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Cinturon Cuero",
        slug: `cinturon-cuero-${suffix}`,
        price: 18000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Marron", sku: `CIN-U-MAR-${suffix}`, onHand: 5 }],
        images: [{ url: "/uploads/cinturon.jpg", altText: "Cinturon", position: 0 }],
      });
      createdProductIds.push(product.id);

      const listing = await listProductsByCategory(prisma, category.slug);

      expect(listing).toHaveLength(1);
      expect(Number(listing[0].price)).toBe(18000);
      expect(listing[0].images[0]?.url).toBe("/uploads/cinturon.jpg");
    });
  });

  describe("getCategoryBySlug", () => {
    it("resolves a category by its slug", async () => {
      const category = await makeCategory("accesorios");

      const found = await getCategoryBySlug(prisma, category.slug);

      expect(found?.id).toBe(category.id);
      expect(found?.name).toBe("accesorios");
    });

    it("returns null for a slug that does not exist", async () => {
      const found = await getCategoryBySlug(prisma, `nope-${randomUUID()}`);

      expect(found).toBeNull();
    });
  });

  describe("listCategoriesWithThumbnail — home page category entry points", () => {
    it("lists categories with a thumbnail sourced from their newest product's first image", async () => {
      const category = await makeCategory("novedades-tile");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Vestido Tile",
        slug: `vestido-tile-${suffix}`,
        price: 40000,
        categoryId: category.id,
        variants: [{ size: "M", color: "Negro", sku: `VT-M-NEG-${suffix}`, onHand: 2 }],
        images: [{ url: "/uploads/vestido-tile.jpg", position: 0 }],
      });
      createdProductIds.push(product.id);

      const categories = await listCategoriesWithThumbnail(prisma);
      const found = categories.find((c) => c.id === category.id);

      expect(found).toBeDefined();
      expect(found?.name).toBe(category.name);
      expect(found?.thumbnailUrl).toBe("/uploads/vestido-tile.jpg");
    });

    it("returns null thumbnailUrl for a category with no products yet", async () => {
      const empty = await makeCategory("tile-sin-productos");

      const categories = await listCategoriesWithThumbnail(prisma);
      const found = categories.find((c) => c.id === empty.id);

      expect(found).toBeDefined();
      expect(found?.thumbnailUrl).toBeNull();
    });
  });
});
