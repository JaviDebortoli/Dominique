import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  addVariant,
  createProduct,
  DuplicateVariantError,
  getProductBySlug,
  isProductIncomplete,
  listAllProductsForAdmin,
  listCuratedProducts,
} from "./product.service";

// Integration tests against the real local Postgres (design.md Testing
// Strategy: "no mocked Prisma"). Each test uses a unique slug/sku suffix so
// runs don't collide with each other or with prior seed data, and tracks
// created product ids for cleanup (deleting a Product cascades to its
// Variant/ProductImage rows per schema.prisma onDelete: Cascade).
describe("product.service (integration, real Postgres)", () => {
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

  describe("Product Structure — product + variants saved linked", () => {
    it("saves the product with its variants linked to it", async () => {
      const category = await makeCategory("vestidos");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Vestido Lino",
        slug: `vestido-lino-${suffix}`,
        price: 45000,
        categoryId: category.id,
        variants: [
          { size: "S", color: "Negro", sku: `LINO-S-NEG-${suffix}`, onHand: 3 },
          { size: "M", color: "Negro", sku: `LINO-M-NEG-${suffix}`, onHand: 5 },
        ],
      });
      createdProductIds.push(product.id);

      expect(product.variants).toHaveLength(2);
      for (const variant of product.variants) {
        expect(variant.productId).toBe(product.id);
      }
      const sizes = product.variants.map((v) => v.size).sort();
      expect(sizes).toEqual(["M", "S"]);

      const persisted = await prisma.variant.findMany({
        where: { productId: product.id },
      });
      expect(persisted).toHaveLength(2);
    });
  });

  describe("Variant Uniqueness — duplicate size/color rejected", () => {
    it("rejects a duplicate size+color variant added to an existing product", async () => {
      const category = await makeCategory("remeras");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Remera Basica",
        slug: `remera-basica-${suffix}`,
        price: 12000,
        categoryId: category.id,
        variants: [
          { size: "M", color: "Negro", sku: `REM-M-NEG-${suffix}`, onHand: 4 },
        ],
      });
      createdProductIds.push(product.id);

      await expect(
        addVariant(prisma, product.id, {
          size: "M",
          color: "Negro",
          sku: `REM-M-NEG-DUP-${suffix}`,
          onHand: 1,
        }),
      ).rejects.toThrow(DuplicateVariantError);

      const variants = await prisma.variant.findMany({
        where: { productId: product.id },
      });
      expect(variants).toHaveLength(1);
    });

    it("rejects a duplicate size+color pair within the same creation payload", async () => {
      const category = await makeCategory("camperas");
      const suffix = randomUUID();

      await expect(
        createProduct(prisma, {
          name: "Campera Denim",
          slug: `campera-denim-${suffix}`,
          price: 60000,
          categoryId: category.id,
          variants: [
            { size: "L", color: "Azul", sku: `CAM-L-AZ-A-${suffix}`, onHand: 2 },
            { size: "L", color: "Azul", sku: `CAM-L-AZ-B-${suffix}`, onHand: 1 },
          ],
        }),
      ).rejects.toThrow(DuplicateVariantError);

      const persisted = await prisma.product.findUnique({
        where: { slug: `campera-denim-${suffix}` },
      });
      expect(persisted).toBeNull();
    });
  });

  describe("Product without images — saved but flagged incomplete", () => {
    it("still saves the product with no images and flags it incomplete", async () => {
      const category = await makeCategory("polleras");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Pollera Plisada",
        slug: `pollera-plisada-${suffix}`,
        price: 30000,
        categoryId: category.id,
        variants: [
          { size: "U", color: "Beige", sku: `POL-U-BEI-${suffix}`, onHand: 6 },
        ],
      });
      createdProductIds.push(product.id);

      expect(product.images).toHaveLength(0);
      expect(isProductIncomplete(product)).toBe(true);
    });

    it("does NOT flag a product that has at least one image", async () => {
      const category = await makeCategory("blusas");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Blusa Seda",
        slug: `blusa-seda-${suffix}`,
        price: 38000,
        categoryId: category.id,
        variants: [
          { size: "S", color: "Blanco", sku: `BLU-S-BLA-${suffix}`, onHand: 2 },
        ],
        images: [{ url: "/uploads/blusa-seda.jpg", position: 0 }],
      });
      createdProductIds.push(product.id);

      expect(product.images).toHaveLength(1);
      expect(isProductIncomplete(product)).toBe(false);
    });
  });

  describe("listCuratedProducts — Home Page Layout: curated products", () => {
    it("returns the most recently created products, newest first, up to the requested limit", async () => {
      const category = await makeCategory("curados");
      const suffix = randomUUID();

      const older = await createProduct(prisma, {
        name: "Producto Viejo",
        slug: `producto-viejo-${suffix}`,
        price: 20000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Negro", sku: `PV-U-NEG-${suffix}`, onHand: 1 }],
      });
      createdProductIds.push(older.id);

      const newer = await createProduct(prisma, {
        name: "Producto Nuevo",
        slug: `producto-nuevo-${suffix}`,
        price: 25000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Negro", sku: `PN-U-NEG-${suffix}`, onHand: 1 }],
      });
      createdProductIds.push(newer.id);

      const curated = await listCuratedProducts(prisma, { take: 1 });

      expect(curated).toHaveLength(1);
      expect(curated[0].id).toBe(newer.id);
    });
  });

  describe("getProductBySlug — PDP lookup", () => {
    it("resolves a product by slug with its variants and images", async () => {
      const category = await makeCategory("pdp-lookup");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Vestido PDP",
        slug: `vestido-pdp-${suffix}`,
        price: 47000,
        categoryId: category.id,
        variants: [
          { size: "S", color: "Negro", sku: `VPDP-S-NEG-${suffix}`, onHand: 2 },
          { size: "M", color: "Negro", sku: `VPDP-M-NEG-${suffix}`, onHand: 0 },
        ],
        images: [{ url: "/uploads/vestido-pdp.jpg", position: 0 }],
      });
      createdProductIds.push(product.id);

      const found = await getProductBySlug(prisma, product.slug);

      expect(found?.id).toBe(product.id);
      expect(found?.variants).toHaveLength(2);
      expect(found?.images[0]?.url).toBe("/uploads/vestido-pdp.jpg");
    });

    it("returns null for a slug that does not exist", async () => {
      const found = await getProductBySlug(prisma, `nope-${randomUUID()}`);

      expect(found).toBeNull();
    });
  });

  // tasks.md 7.3 — admin/productos list (specs/admin-console/spec.md
  // "Product and Variant Management": staff manage products "without
  // engineering assistance", which starts with seeing what already exists.
  describe("listAllProductsForAdmin — admin catalog listing", () => {
    it("lists every product with its category, variants, and images (unlike the storefront's curated/per-category views)", async () => {
      const category = await makeCategory("admin-list");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Producto Admin",
        slug: `producto-admin-${suffix}`,
        price: 12000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Unico", sku: `ADM-${suffix}`, onHand: 4 }],
        images: [{ url: "/uploads/producto-admin.jpg", position: 0 }],
      });
      createdProductIds.push(product.id);

      const rows = await listAllProductsForAdmin(prisma);
      const found = rows.find((row) => row.id === product.id);

      expect(found).toBeDefined();
      expect(found?.category.id).toBe(category.id);
      expect(found?.variants).toHaveLength(1);
      expect(found?.images).toHaveLength(1);
    });
  });
});
