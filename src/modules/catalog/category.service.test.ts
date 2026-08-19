import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct } from "./product.service";
import {
  CategoryHasProductsError,
  CategoryNotFoundError,
  createCategory,
  deleteCategory,
  DuplicateCategoryNameError,
  DuplicateCategorySlugError,
  getCategoryBySlug,
  listAllCategoriesForAdmin,
  listCategoriesWithThumbnail,
  listProductsByCategory,
  renameCategory,
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

  // tasks.md 2.1 — write path for the admin category-creation slice
  // (design.md C1/C2/C3, specs/admin-console/spec.md "Product and Variant
  // Management": category creation, slug uniqueness).
  describe("createCategory", () => {
    it("persists a category row with the given name and slug", async () => {
      const suffix = randomUUID();
      const slug = `bijouteria-${suffix}`;

      const category = await createCategory(prisma, { name: "Bijouteria", slug });
      createdCategoryIds.push(category.id);

      expect(category.name).toBe("Bijouteria");
      expect(category.slug).toBe(slug);

      const saved = await prisma.category.findUnique({ where: { id: category.id } });
      expect(saved?.slug).toBe(slug);
    });

    it("throws DuplicateCategorySlugError on a duplicate slug and writes nothing new", async () => {
      const suffix = randomUUID();
      const slug = `calzado-${suffix}`;

      const first = await createCategory(prisma, { name: "Calzado", slug });
      createdCategoryIds.push(first.id);

      const beforeCount = await prisma.category.count({ where: { slug } });
      expect(beforeCount).toBe(1);

      await expect(createCategory(prisma, { name: "Calzado Otra Vez", slug })).rejects.toThrow(
        DuplicateCategorySlugError,
      );

      const afterCount = await prisma.category.count({ where: { slug } });
      expect(afterCount).toBe(1);
    });

    it("DuplicateCategorySlugError carries the offending slug", async () => {
      const suffix = randomUUID();
      const slug = `accesorios-dup-${suffix}`;

      const first = await createCategory(prisma, { name: "Accesorios", slug });
      createdCategoryIds.push(first.id);

      try {
        await createCategory(prisma, { name: "Accesorios Otra Vez", slug });
        expect.unreachable("expected createCategory to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(DuplicateCategorySlugError);
        expect((error as DuplicateCategorySlugError).slug).toBe(slug);
        expect((error as Error).name).toBe("DuplicateCategorySlugError");
      }
    });
  });

  describe("listAllCategoriesForAdmin", () => {
    it("returns each category's productCount and orders by name asc", async () => {
      const suffix = randomUUID();
      const zebra = await prisma.category.create({
        data: { name: `Zebra Admin List ${suffix}`, slug: `zebra-admin-list-${suffix}` },
      });
      createdCategoryIds.push(zebra.id);
      const alpha = await prisma.category.create({
        data: { name: `Alpha Admin List ${suffix}`, slug: `alpha-admin-list-${suffix}` },
      });
      createdCategoryIds.push(alpha.id);

      const productSuffix = randomUUID();
      const product = await createProduct(prisma, {
        name: "Producto Alpha List",
        slug: `producto-alpha-list-${productSuffix}`,
        price: 12000,
        categoryId: alpha.id,
        variants: [{ size: "U", color: "Unico", sku: `ALPHA-${productSuffix}`, onHand: 1 }],
      });
      createdProductIds.push(product.id);

      const rows = await listAllCategoriesForAdmin(prisma);

      const alphaRow = rows.find((r) => r.id === alpha.id);
      const zebraRow = rows.find((r) => r.id === zebra.id);
      expect(alphaRow?.productCount).toBe(1);
      expect(zebraRow?.productCount).toBe(0);

      const alphaIndex = rows.findIndex((r) => r.id === alpha.id);
      const zebraIndex = rows.findIndex((r) => r.id === zebra.id);
      expect(alphaIndex).toBeLessThan(zebraIndex);
    });
  });

  // tasks.md 1.1 — rename/delete write paths for the admin category-edit
  // slice (design.md E1-E4, specs/admin-console/spec.md "Product and
  // Variant Management": rename, duplicate-name rejection, delete,
  // delete-blocked, not-found handling).
  describe("renameCategory", () => {
    it("persists the new name and leaves slug byte-identical", async () => {
      const suffix = randomUUID();
      const category = await prisma.category.create({
        data: { name: `Original Name ${suffix}`, slug: `original-name-${suffix}` },
      });
      createdCategoryIds.push(category.id);

      const renamed = await renameCategory(prisma, category.id, {
        name: `Renamed Name ${suffix}`,
      });

      expect(renamed.name).toBe(`Renamed Name ${suffix}`);
      expect(renamed.slug).toBe(category.slug);

      const saved = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
      expect(saved.slug).toBe(category.slug);
      expect(saved.name).toBe(`Renamed Name ${suffix}`);
    });

    it("rejects a name colliding case-insensitively with another category, writing nothing", async () => {
      const suffix = randomUUID();
      const existing = await prisma.category.create({
        data: { name: `bijou-${suffix}`, slug: `bijou-${suffix}` },
      });
      createdCategoryIds.push(existing.id);
      const target = await prisma.category.create({
        data: { name: `Accesorios ${suffix}`, slug: `accesorios-${suffix}` },
      });
      createdCategoryIds.push(target.id);

      await expect(
        renameCategory(prisma, target.id, { name: `BIJOU-${suffix}` }),
      ).rejects.toThrow(DuplicateCategoryNameError);

      const unchanged = await prisma.category.findUniqueOrThrow({ where: { id: target.id } });
      expect(unchanged.name).toBe(`Accesorios ${suffix}`);
    });

    it("allows a case-only self-rename on the same row", async () => {
      const suffix = randomUUID();
      const category = await prisma.category.create({
        data: { name: `Bijou ${suffix}`, slug: `bijou-self-${suffix}` },
      });
      createdCategoryIds.push(category.id);

      const renamed = await renameCategory(prisma, category.id, {
        name: `bijou ${suffix}`,
      });

      expect(renamed.name).toBe(`bijou ${suffix}`);
    });

    it("does not falsely collide when the new name contains a % wildcard character", async () => {
      const suffix = randomUUID();
      const unrelated = await prisma.category.create({
        data: { name: `Zapatos Cerrados ${suffix}`, slug: `zapatos-cerrados-${suffix}` },
      });
      createdCategoryIds.push(unrelated.id);
      const target = await prisma.category.create({
        data: { name: `Target ${suffix}`, slug: `target-percent-${suffix}` },
      });
      createdCategoryIds.push(target.id);

      const renamed = await renameCategory(prisma, target.id, {
        name: `Zapatos%${suffix}`,
      });

      expect(renamed.name).toBe(`Zapatos%${suffix}`);
    });

    it("throws CategoryNotFoundError for an unknown id", async () => {
      await expect(
        renameCategory(prisma, `does-not-exist-${randomUUID()}`, { name: "No Existe" }),
      ).rejects.toThrow(CategoryNotFoundError);
    });
  });

  describe("deleteCategory", () => {
    it("removes an empty category", async () => {
      const suffix = randomUUID();
      const category = await prisma.category.create({
        data: { name: `Borrar ${suffix}`, slug: `borrar-${suffix}` },
      });

      await deleteCategory(prisma, category.id);

      const found = await prisma.category.findUnique({ where: { id: category.id } });
      expect(found).toBeNull();
    });

    it("throws CategoryHasProductsError with the exact productCount and deletes nothing when products reference it", async () => {
      const suffix = randomUUID();
      const category = await prisma.category.create({
        data: { name: `Con Productos ${suffix}`, slug: `con-productos-${suffix}` },
      });
      createdCategoryIds.push(category.id);
      const product = await createProduct(prisma, {
        name: `Producto Con Categoria ${suffix}`,
        slug: `producto-con-categoria-${suffix}`,
        price: 15000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Unico", sku: `PCC-${suffix}`, onHand: 1 }],
      });
      createdProductIds.push(product.id);

      try {
        await deleteCategory(prisma, category.id);
        expect.unreachable("expected deleteCategory to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(CategoryHasProductsError);
        expect((error as CategoryHasProductsError).categoryId).toBe(category.id);
        expect((error as CategoryHasProductsError).productCount).toBe(1);
      }

      const stillThere = await prisma.category.findUnique({ where: { id: category.id } });
      expect(stillThere).not.toBeNull();
    });

    it("throws CategoryNotFoundError for an unknown id", async () => {
      await expect(
        deleteCategory(prisma, `does-not-exist-${randomUUID()}`),
      ).rejects.toThrow(CategoryNotFoundError);
    });
  });
});
