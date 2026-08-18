import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  addVariant,
  createProduct,
  deleteProduct,
  deleteVariant,
  DuplicateSkuError,
  DuplicateVariantError,
  getProductBySlug,
  isProductIncomplete,
  LastVariantError,
  listAllProductsForAdmin,
  listCuratedProducts,
  ProductCategoryNotFoundError,
  ProductHasHistoryError,
  ProductHasStockError,
  ProductNotFoundError,
  updateProduct,
  updateVariant,
  VariantAttributesImmutableError,
  VariantHasHistoryError,
  VariantHasStockError,
  VariantNotFoundError,
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

  // tasks.md 1.1/1.2 — design.md F1: updateProduct never writes slug.
  describe("updateProduct — Product edit (F1)", () => {
    it("persists name/description/price/categoryId and leaves slug byte-identical", async () => {
      const category = await makeCategory("update-product-a");
      const otherCategory = await makeCategory("update-product-b");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Vestido Original",
        slug: `vestido-original-${suffix}`,
        description: "Descripcion original",
        price: 10000,
        categoryId: category.id,
        variants: [{ size: "M", color: "Negro", sku: `UPD-M-NEG-${suffix}`, onHand: 1 }],
      });
      createdProductIds.push(product.id);

      const updated = await updateProduct(prisma, product.id, {
        name: "Vestido Actualizado",
        description: "Descripcion nueva",
        price: 15000,
        categoryId: otherCategory.id,
      });

      expect(updated.name).toBe("Vestido Actualizado");
      expect(updated.description).toBe("Descripcion nueva");
      expect(Number(updated.price)).toBe(15000);
      expect(updated.categoryId).toBe(otherCategory.id);
      expect(updated.slug).toBe(product.slug);
    });

    it("throws ProductNotFoundError for an unknown product id", async () => {
      await expect(
        updateProduct(prisma, `nope-${randomUUID()}`, { name: "X" }),
      ).rejects.toThrow(ProductNotFoundError);
    });

    it("throws ProductCategoryNotFoundError for an unknown categoryId", async () => {
      const category = await makeCategory("update-product-c");
      const suffix = randomUUID();
      const product = await createProduct(prisma, {
        name: "Vestido C",
        slug: `vestido-c-${suffix}`,
        price: 10000,
        categoryId: category.id,
        variants: [{ size: "M", color: "Negro", sku: `UPD-C-${suffix}`, onHand: 1 }],
      });
      createdProductIds.push(product.id);

      await expect(
        updateProduct(prisma, product.id, { categoryId: `nope-${randomUUID()}` }),
      ).rejects.toThrow(ProductCategoryNotFoundError);
    });
  });

  // tasks.md 1.3/1.4 — design.md F2/F3: pre-check onHand, DB-adjudicated
  // history via P2003.
  describe("deleteProduct — Product delete (F2/F3)", () => {
    it("throws ProductHasHistoryError with exact counts and deletes nothing when a variant has an OrderItem row", async () => {
      const category = await makeCategory("delete-product-history");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Producto Historial",
        slug: `producto-historial-${suffix}`,
        price: 20000,
        categoryId: category.id,
        variants: [{ size: "M", color: "Negro", sku: `HIST-M-NEG-${suffix}`, onHand: 0 }],
      });
      createdProductIds.push(product.id);
      const variant = product.variants[0];

      const order = await prisma.order.create({
        data: {
          publicCode: `HIST-${suffix}`,
          buyerName: "Compradora Test",
          phone: "3800000000",
          email: "test@example.com",
          method: "PICKUP_CASH",
          status: "PAID",
          items: { create: [{ variantId: variant.id, qty: 1, unitPrice: 20000 }] },
        },
      });
      await prisma.stockMovement.create({
        data: { variantId: variant.id, delta: 1, reason: "PAID", orderId: order.id },
      });

      try {
        await deleteProduct(prisma, product.id);
        expect.unreachable("deleteProduct should have thrown ProductHasHistoryError");
      } catch (error) {
        expect(error).toBeInstanceOf(ProductHasHistoryError);
        const historyError = error as ProductHasHistoryError;
        expect(historyError.orderItemCount).toBe(1);
        expect(historyError.stockMovementCount).toBe(1);
      }

      const stillExists = await prisma.product.findUnique({ where: { id: product.id } });
      expect(stillExists).not.toBeNull();

      // Unblock afterAll's cleanup: RESTRICT on variantId means the order's
      // history rows must go before the product's cascading variant delete.
      await prisma.stockMovement.deleteMany({ where: { orderId: order.id } });
      await prisma.order.delete({ where: { id: order.id } });
    });

    it("succeeds on a clean product and cascades its variants + images away", async () => {
      const category = await makeCategory("delete-product-clean");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Producto Limpio",
        slug: `producto-limpio-${suffix}`,
        price: 18000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Blanco", sku: `CLEAN-${suffix}`, onHand: 0 }],
        images: [{ url: "/uploads/producto-limpio.jpg", position: 0 }],
      });
      const variantId = product.variants[0].id;
      const imageId = product.images[0].id;

      await deleteProduct(prisma, product.id);

      expect(await prisma.product.findUnique({ where: { id: product.id } })).toBeNull();
      expect(await prisma.variant.findUnique({ where: { id: variantId } })).toBeNull();
      expect(await prisma.productImage.findUnique({ where: { id: imageId } })).toBeNull();
    });

    it("throws ProductHasStockError naming the SKU for a variant with onHand > 0 and no StockMovement row", async () => {
      const category = await makeCategory("delete-product-stock");
      const suffix = randomUUID();
      const sku = `STOCK-${suffix}`;

      const product = await createProduct(prisma, {
        name: "Producto Con Stock",
        slug: `producto-con-stock-${suffix}`,
        price: 22000,
        categoryId: category.id,
        variants: [{ size: "M", color: "Negro", sku, onHand: 5 }],
      });
      createdProductIds.push(product.id);

      await expect(deleteProduct(prisma, product.id)).rejects.toThrow(ProductHasStockError);

      try {
        await deleteProduct(prisma, product.id);
      } catch (error) {
        expect(error).toBeInstanceOf(ProductHasStockError);
        expect((error as ProductHasStockError).skus).toEqual([sku]);
      }

      expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
    });

    it("throws ProductNotFoundError for an unknown product id", async () => {
      await expect(deleteProduct(prisma, `nope-${randomUUID()}`)).rejects.toThrow(
        ProductNotFoundError,
      );
    });
  });

  // tasks.md 1.5/1.6 — design.md F4: last-variant unconditional, then
  // onHand > 0, then DB-adjudicated history via P2003. No $transaction.
  describe("deleteVariant — Variant delete (F4)", () => {
    it("throws LastVariantError when one variant remains, even if that variant is clean", async () => {
      const category = await makeCategory("delete-variant-last");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Producto Unica Variante",
        slug: `producto-unica-variante-${suffix}`,
        price: 15000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Negro", sku: `LAST-${suffix}`, onHand: 0 }],
      });
      createdProductIds.push(product.id);
      const variant = product.variants[0];

      await expect(deleteVariant(prisma, variant.id)).rejects.toThrow(LastVariantError);

      try {
        await deleteVariant(prisma, variant.id);
      } catch (error) {
        expect(error).toBeInstanceOf(LastVariantError);
        expect((error as LastVariantError).productId).toBe(product.id);
        expect((error as LastVariantError).variantId).toBe(variant.id);
      }

      expect(await prisma.variant.findUnique({ where: { id: variant.id } })).not.toBeNull();
    });

    it("throws VariantHasStockError for onHand > 0", async () => {
      const category = await makeCategory("delete-variant-stock");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Producto Variante Stock",
        slug: `producto-variante-stock-${suffix}`,
        price: 16000,
        categoryId: category.id,
        variants: [
          { size: "S", color: "Negro", sku: `VSTOCK-S-${suffix}`, onHand: 3 },
          { size: "M", color: "Negro", sku: `VSTOCK-M-${suffix}`, onHand: 0 },
        ],
      });
      createdProductIds.push(product.id);
      const stockedVariant = product.variants.find((v) => v.onHand > 0)!;

      try {
        await deleteVariant(prisma, stockedVariant.id);
        expect.unreachable("deleteVariant should have thrown VariantHasStockError");
      } catch (error) {
        expect(error).toBeInstanceOf(VariantHasStockError);
        const stockError = error as VariantHasStockError;
        expect(stockError.variantId).toBe(stockedVariant.id);
        expect(stockError.sku).toBe(stockedVariant.sku);
        expect(stockError.onHand).toBe(3);
      }

      expect(
        await prisma.variant.findUnique({ where: { id: stockedVariant.id } }),
      ).not.toBeNull();
    });

    it("throws VariantHasHistoryError for a StockMovement row", async () => {
      const category = await makeCategory("delete-variant-history");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Producto Variante Historial",
        slug: `producto-variante-historial-${suffix}`,
        price: 17000,
        categoryId: category.id,
        variants: [
          { size: "S", color: "Negro", sku: `VHIST-S-${suffix}`, onHand: 0 },
          { size: "M", color: "Negro", sku: `VHIST-M-${suffix}`, onHand: 0 },
        ],
      });
      createdProductIds.push(product.id);
      const [targetVariant] = product.variants;

      await prisma.stockMovement.create({
        data: { variantId: targetVariant.id, delta: 1, reason: "ADJUSTMENT" },
      });

      try {
        await deleteVariant(prisma, targetVariant.id);
        expect.unreachable("deleteVariant should have thrown VariantHasHistoryError");
      } catch (error) {
        expect(error).toBeInstanceOf(VariantHasHistoryError);
        const historyError = error as VariantHasHistoryError;
        expect(historyError.variantId).toBe(targetVariant.id);
        expect(historyError.orderItemCount).toBe(0);
        expect(historyError.stockMovementCount).toBe(1);
      }

      expect(await prisma.variant.findUnique({ where: { id: targetVariant.id } })).not.toBeNull();

      await prisma.stockMovement.deleteMany({ where: { variantId: targetVariant.id } });
    });

    it("succeeds on a clean non-last variant", async () => {
      const category = await makeCategory("delete-variant-clean");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Producto Dos Variantes",
        slug: `producto-dos-variantes-${suffix}`,
        price: 19000,
        categoryId: category.id,
        variants: [
          { size: "S", color: "Negro", sku: `CLEANV-S-${suffix}`, onHand: 0 },
          { size: "M", color: "Negro", sku: `CLEANV-M-${suffix}`, onHand: 0 },
        ],
      });
      createdProductIds.push(product.id);
      const [toDelete, remaining] = product.variants;

      await deleteVariant(prisma, toDelete.id);

      expect(await prisma.variant.findUnique({ where: { id: toDelete.id } })).toBeNull();
      expect(await prisma.variant.findUnique({ where: { id: remaining.id } })).not.toBeNull();
      expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
    });

    it("throws VariantNotFoundError for an unknown variant id", async () => {
      await expect(deleteVariant(prisma, `nope-${randomUUID()}`)).rejects.toThrow(
        VariantNotFoundError,
      );
    });
  });

  // tasks.md 1.7/1.8 — design.md F5/F6/F7: resolved-pair pre-check for
  // size/color, P2002 catch for sku, OrderItem gate on size/color.
  describe("updateVariant — Variant edit (F5/F6)", () => {
    it("changes sku", async () => {
      const category = await makeCategory("update-variant-sku");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Producto Variante SKU",
        slug: `producto-variante-sku-${suffix}`,
        price: 14000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Negro", sku: `OLD-${suffix}`, onHand: 0 }],
      });
      createdProductIds.push(product.id);
      const variant = product.variants[0];
      const newSku = `NEW-${suffix}`;

      const updated = await updateVariant(prisma, variant.id, { sku: newSku });

      expect(updated.sku).toBe(newSku);
    });

    it("rejects a duplicate sku with DuplicateSkuError", async () => {
      const category = await makeCategory("update-variant-dupsku");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Producto Variante Dup SKU",
        slug: `producto-variante-dupsku-${suffix}`,
        price: 13000,
        categoryId: category.id,
        variants: [
          { size: "S", color: "Negro", sku: `DUPSKU-A-${suffix}`, onHand: 0 },
          { size: "M", color: "Negro", sku: `DUPSKU-B-${suffix}`, onHand: 0 },
        ],
      });
      createdProductIds.push(product.id);
      const [variantA, variantB] = product.variants;

      await expect(
        updateVariant(prisma, variantA.id, { sku: variantB.sku }),
      ).rejects.toThrow(DuplicateSkuError);
    });

    it("rejects a size/color change colliding with a sibling's resolved pair via DuplicateVariantError", async () => {
      const category = await makeCategory("update-variant-duppair");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Producto Variante Dup Pair",
        slug: `producto-variante-duppair-${suffix}`,
        price: 13500,
        categoryId: category.id,
        variants: [
          { size: "S", color: "Negro", sku: `DUPPAIR-A-${suffix}`, onHand: 0 },
          { size: "M", color: "Negro", sku: `DUPPAIR-B-${suffix}`, onHand: 0 },
        ],
      });
      createdProductIds.push(product.id);
      const [variantA] = product.variants;

      // variantA is (S, Negro); resolving only `size: "M"` over its current
      // color "Negro" yields (M, Negro), which collides with variantB.
      await expect(
        updateVariant(prisma, variantA.id, { size: "M" }),
      ).rejects.toThrow(DuplicateVariantError);
    });

    it("rejects size/color with VariantAttributesImmutableError once an OrderItem exists, while sku-only still succeeds", async () => {
      const category = await makeCategory("update-variant-immutable");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: "Producto Variante Historial",
        slug: `producto-variante-immutable-${suffix}`,
        price: 21000,
        categoryId: category.id,
        variants: [{ size: "S", color: "Negro", sku: `IMMUT-${suffix}`, onHand: 0 }],
      });
      createdProductIds.push(product.id);
      const variant = product.variants[0];

      const order = await prisma.order.create({
        data: {
          publicCode: `IMMUT-${suffix}`,
          buyerName: "Compradora Immut",
          phone: "3800000001",
          email: "immut@example.com",
          method: "PICKUP_CASH",
          status: "PAID",
          items: { create: [{ variantId: variant.id, qty: 1, unitPrice: 21000 }] },
        },
      });

      try {
        await updateVariant(prisma, variant.id, { color: "Blanco" });
        expect.unreachable("updateVariant should have thrown VariantAttributesImmutableError");
      } catch (error) {
        expect(error).toBeInstanceOf(VariantAttributesImmutableError);
        const immutableError = error as VariantAttributesImmutableError;
        expect(immutableError.variantId).toBe(variant.id);
        expect(immutableError.orderItemCount).toBe(1);
      }

      const newSku = `IMMUT-SKU-${suffix}`;
      const updated = await updateVariant(prisma, variant.id, { sku: newSku });
      expect(updated.sku).toBe(newSku);

      await prisma.order.delete({ where: { id: order.id } });
    });

    it("throws VariantNotFoundError for an unknown variant id", async () => {
      await expect(
        updateVariant(prisma, `nope-${randomUUID()}`, { sku: "whatever" }),
      ).rejects.toThrow(VariantNotFoundError);
    });
  });
});
