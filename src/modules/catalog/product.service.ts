// Catalog module — product write/read path (design.md D1: business logic
// lives in src/modules/*, never in route handlers, so admin routes and
// future seed/import scripts share this one code path).
//
// Backs specs/product-catalog/spec.md:
//   - "Product Structure" (product + variants saved linked)
//   - "Variant Uniqueness" (duplicate size/color rejected)
//   - "Product without images" (still saves, flagged incomplete)

import type {
  Category,
  Prisma,
  PrismaClient,
  Product,
  ProductImage,
  Variant,
} from "@/generated/prisma/client";

// Product/variant edit+delete path — admin-productos-edicion change
// (design.md F1-F9). Mirrors category.service.ts's error-class shape: every
// error carries the id(s) it failed on, `this.name` is the class name, and
// the route owns all Spanish copy (E4).
export class ProductNotFoundError extends Error {
  constructor(public readonly productId: string) {
    super(`Product ${productId} not found.`);
    this.name = "ProductNotFoundError";
  }
}

/** F1 — `categoryId` in the PATCH payload no longer resolves to a category. */
export class ProductCategoryNotFoundError extends Error {
  constructor(public readonly categoryId: string) {
    super(`Category ${categoryId} not found.`);
    this.name = "ProductCategoryNotFoundError";
  }
}

/** F2/F3 — a variant has onHand > 0; carries the SKUs to zero out in
 * /admin/caja. Pre-checked because `createProduct` writes initial stock
 * directly with no StockMovement row, so RESTRICT cannot see it. */
export class ProductHasStockError extends Error {
  constructor(
    public readonly productId: string,
    public readonly skus: string[],
  ) {
    super(`Product ${productId} has stock on hand for: ${skus.join(", ")}.`);
    this.name = "ProductHasStockError";
  }
}

/** F2/F3 — DB-adjudicated via P2003; counts explain, never gate. */
export class ProductHasHistoryError extends Error {
  constructor(
    public readonly productId: string,
    public readonly orderItemCount: number,
    public readonly stockMovementCount: number,
  ) {
    super(
      `Product ${productId} has ${orderItemCount} order item(s) and ${stockMovementCount} stock movement(s).`,
    );
    this.name = "ProductHasHistoryError";
  }
}

export class VariantNotFoundError extends Error {
  constructor(public readonly variantId: string) {
    super(`Variant ${variantId} not found.`);
    this.name = "VariantNotFoundError";
  }
}

/** F4 — unconditional: a Product must keep >= 1 Variant. Checked first
 * because its remedy ("delete the product instead") differs in kind from
 * every other blocking cause. */
export class LastVariantError extends Error {
  constructor(
    public readonly productId: string,
    public readonly variantId: string,
  ) {
    super(`Variant ${variantId} is the last remaining variant of product ${productId}.`);
    this.name = "LastVariantError";
  }
}

export class VariantHasStockError extends Error {
  constructor(
    public readonly variantId: string,
    public readonly sku: string,
    public readonly onHand: number,
  ) {
    super(`Variant ${variantId} (${sku}) has ${onHand} unit(s) on hand.`);
    this.name = "VariantHasStockError";
  }
}

export class VariantHasHistoryError extends Error {
  constructor(
    public readonly variantId: string,
    public readonly orderItemCount: number,
    public readonly stockMovementCount: number,
  ) {
    super(
      `Variant ${variantId} has ${orderItemCount} order item(s) and ${stockMovementCount} stock movement(s).`,
    );
    this.name = "VariantHasHistoryError";
  }
}

export class DuplicateSkuError extends Error {
  constructor(public readonly sku: string) {
    super(`A variant with sku "${sku}" already exists.`);
    this.name = "DuplicateSkuError";
  }
}

/** F6 — size/color are writable fields, so the rejection is a conflict with
 * the resource's current state (409), not a malformed request (400): the
 * same PATCH succeeds against a variant with no order history. */
export class VariantAttributesImmutableError extends Error {
  constructor(
    public readonly variantId: string,
    public readonly orderItemCount: number,
  ) {
    super(`Variant ${variantId} has ${orderItemCount} order item(s); size/color are frozen.`);
    this.name = "VariantAttributesImmutableError";
  }
}

export class DuplicateVariantError extends Error {
  constructor(
    public readonly productId: string,
    public readonly size: string,
    public readonly color: string,
  ) {
    super(
      `Variant with size "${size}" and color "${color}" already exists for product ${productId}. Edit the existing variant instead of creating a new one.`,
    );
    this.name = "DuplicateVariantError";
  }
}

// Admin add-image/delete-image path — admin-productos-avanzado change
// (design.md G1-G4). Mirrors the error-class shape above.
/** G2/G3 — a product already carries the 5-image cap; carries the count
 * that triggered the rejection so the route can echo it in the 409 body. */
export class TooManyImagesError extends Error {
  constructor(
    public readonly productId: string,
    public readonly currentCount: number,
  ) {
    super(`Product ${productId} already has ${currentCount} image(s); the cap is ${MAX_PRODUCT_IMAGES}.`);
    this.name = "TooManyImagesError";
  }
}

/** G4 — DB-adjudicated via P2025; mirrors E3's "attempt the delete, let the
 * DB decide" verbatim, since ProductImage has no non-FK precondition. */
export class ProductImageNotFoundError extends Error {
  constructor(public readonly imageId: string) {
    super(`ProductImage ${imageId} not found.`);
    this.name = "ProductImageNotFoundError";
  }
}

export interface CreateProductVariantInput {
  size: string;
  color: string;
  sku: string;
  priceOverride?: number;
  onHand?: number;
}

export interface CreateProductImageInput {
  url: string;
  altText?: string;
  position?: number;
}

/** G2/G3 — hard cap of 5 images per product, checked before the insert. */
export const MAX_PRODUCT_IMAGES = 5;

export interface AddImageInput {
  url: string;
  altText?: string;
  position?: number;
}

export interface CreateProductInput {
  name: string;
  slug: string;
  description?: string;
  price: number;
  categoryId: string;
  variants: CreateProductVariantInput[];
  images?: CreateProductImageInput[];
}

export type ProductWithRelations = Product & {
  variants: Variant[];
  images: ProductImage[];
};

/** Finds a duplicate size+color pair within a single variants payload,
 * before it ever reaches the DB (spec: reject the duplicate outright). */
function findDuplicatePair(
  variants: CreateProductVariantInput[],
): CreateProductVariantInput | undefined {
  const seen = new Set<string>();
  for (const variant of variants) {
    const key = `${variant.size}::${variant.color}`;
    if (seen.has(key)) return variant;
    seen.add(key);
  }
  return undefined;
}

/**
 * Creates a product with its variants and (optional) images linked in a
 * single write. A product ALWAYS belongs to exactly one category — enforced
 * both by the required `categoryId` here and by the non-nullable
 * relation in schema.prisma (specs/product-catalog "Category Association").
 */
export async function createProduct(
  prisma: PrismaClient,
  input: CreateProductInput,
): Promise<ProductWithRelations> {
  const duplicate = findDuplicatePair(input.variants);
  if (duplicate) {
    throw new DuplicateVariantError("(new product)", duplicate.size, duplicate.color);
  }

  const data: Prisma.ProductCreateInput = {
    name: input.name,
    slug: input.slug,
    description: input.description,
    price: input.price,
    category: { connect: { id: input.categoryId } },
    variants: {
      create: input.variants.map((variant) => ({
        size: variant.size,
        color: variant.color,
        sku: variant.sku,
        priceOverride: variant.priceOverride,
        onHand: variant.onHand ?? 0,
      })),
    },
    images: input.images?.length
      ? {
          create: input.images.map((image, index) => ({
            url: image.url,
            altText: image.altText,
            position: image.position ?? index,
          })),
        }
      : undefined,
  };

  return prisma.product.create({
    data,
    include: { variants: true, images: true },
  });
}

/**
 * Adds a variant to an existing product, rejecting a size+color pair that
 * already exists on that product (spec: "prompt to edit the existing
 * variant instead").
 */
export async function addVariant(
  prisma: PrismaClient,
  productId: string,
  variant: CreateProductVariantInput,
): Promise<Variant> {
  const existing = await prisma.variant.findFirst({
    where: { productId, size: variant.size, color: variant.color },
  });
  if (existing) {
    throw new DuplicateVariantError(productId, variant.size, variant.color);
  }

  try {
    return await prisma.variant.create({
      data: {
        productId,
        size: variant.size,
        color: variant.color,
        sku: variant.sku,
        priceOverride: variant.priceOverride,
        onHand: variant.onHand ?? 0,
      },
    });
  } catch (error) {
    // Race-condition belt-and-suspenders: the @@unique([productId, size,
    // color]) DB constraint (schema.prisma) is the final guarantee even if
    // two concurrent addVariant calls both pass the findFirst check above.
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      throw new DuplicateVariantError(productId, variant.size, variant.color);
    }
    throw error;
  }
}

/**
 * Attaches an already-uploaded image to an existing product (design.md
 * G1-G3). One read — `product.findUnique({ select: { id, images: {
 * select: { position } } } })` — answers three questions at once: existence
 * (ProductNotFoundError), the 5-image cap (TooManyImagesError), and the
 * default `position` (max + 1). Reading the images collection twice (once
 * for the cap, once for the max) would let those two facts disagree.
 */
export async function addImage(
  prisma: PrismaClient,
  productId: string,
  input: AddImageInput,
): Promise<ProductImage> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, images: { select: { position: true } } },
  });
  if (!product) {
    throw new ProductNotFoundError(productId);
  }

  if (product.images.length >= MAX_PRODUCT_IMAGES) {
    throw new TooManyImagesError(productId, product.images.length);
  }

  const maxPosition = product.images.reduce((max, image) => Math.max(max, image.position), -1);

  return prisma.productImage.create({
    data: {
      productId,
      url: input.url,
      altText: input.altText,
      position: input.position ?? maxPosition + 1,
    },
  });
}

/**
 * Deletes a ProductImage by its own PK (design.md G4) — the `[id]` segment
 * of the route is NOT re-validated against `image.productId`; a cuid PK
 * fully identifies the row. Deleting a product's last image is freely
 * allowed: zero images is already a valid product state
 * (isProductIncomplete tolerates it). Mirrors E3 verbatim: ProductImage has
 * no non-FK precondition, so P2025 is the whole enforcement — no pre-check.
 */
export async function deleteImage(prisma: PrismaClient, imageId: string): Promise<void> {
  try {
    await prisma.productImage.delete({ where: { id: imageId } });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2025") {
      throw new ProductImageNotFoundError(imageId);
    }
    throw error;
  }
}

/**
 * A product with zero images is still valid to save (spec: "SHALL still
 * allow the save") but SHOULD be flagged incomplete for storefront display.
 * This is a derived/computed flag, not a stored column — recomputing it
 * keeps "incomplete" always accurate as images are added/removed later.
 */
export function isProductIncomplete(product: { images: unknown[] }): boolean {
  return product.images.length === 0;
}

export type CuratedProduct = Product & { images: ProductImage[] };

/**
 * Lists the most recently created products for the home page's "curated"
 * section (specs/storefront-browsing/spec.md "Home Page Layout"). There is
 * no manual curation flag in the schema (see design.md's Data Model
 * Sketch) — newest-first is the simplest data-driven stand-in and matches
 * listProductsByCategory's existing ordering convention.
 */
export async function listCuratedProducts(
  prisma: PrismaClient,
  options: { take?: number } = {},
): Promise<CuratedProduct[]> {
  return prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    take: options.take ?? 4,
    include: { images: { orderBy: { position: "asc" }, take: 1 } },
  });
}

/**
 * Resolves a single product by its public slug, with all variants and
 * images, for the product detail page (specs/storefront-browsing/spec.md
 * "Product Detail Page Variant Selector"). Returns null when no product
 * matches the slug.
 */
export async function getProductBySlug(
  prisma: PrismaClient,
  slug: string,
): Promise<ProductWithRelations | null> {
  return prisma.product.findUnique({
    where: { slug },
    include: {
      variants: true,
      images: { orderBy: { position: "asc" } },
    },
  });
}

// No `slug`, `onHand`, `held`, or `priceOverride` field — structurally
// unwritable (F7): slug is immutable (E5's rule generalized), stock fields
// are owned exclusively by stock.service.ts.
export interface UpdateProductInput {
  name?: string;
  description?: string | null;
  price?: number;
  categoryId?: string;
}

/**
 * Updates a product's editable fields. `slug` is never written. Relies on
 * the DB to adjudicate both failure modes (design.md F1, mirrors E3):
 * P2025 (no such product) -> ProductNotFoundError, P2003 (categoryId FK)
 * -> ProductCategoryNotFoundError. No pre-check — a bad categoryId can only
 * mean a stale admin tab (the picker is DB-seeded), so the round-trip a
 * pre-check would cost on every happy-path edit buys nothing.
 */
export async function updateProduct(
  prisma: PrismaClient,
  id: string,
  input: UpdateProductInput,
): Promise<Product> {
  try {
    return await prisma.product.update({
      where: { id },
      data: input,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "P2025") {
        throw new ProductNotFoundError(id);
      }
      if (code === "P2003") {
        throw new ProductCategoryNotFoundError(input.categoryId ?? "");
      }
    }
    throw error;
  }
}

/**
 * Hard-deletes a product, cascading its Variants and ProductImages
 * (design.md F2/F3). `onHand > 0` is pre-checked — it is not a foreign key,
 * so no catch clause can ever see it (see design.md Technical Approach).
 * History (OrderItem/StockMovement) stays DB-adjudicated via P2003, exactly
 * as deleteCategory does (E3): attempt the delete, count on failure only to
 * explain the block, never to gate it.
 */
export async function deleteProduct(prisma: PrismaClient, id: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id },
    select: { variants: { select: { id: true, sku: true, onHand: true } } },
  });
  if (!product) {
    throw new ProductNotFoundError(id);
  }

  const stockedSkus = product.variants.filter((v) => v.onHand > 0).map((v) => v.sku);
  if (stockedSkus.length > 0) {
    throw new ProductHasStockError(id, stockedSkus);
  }

  try {
    await prisma.product.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2003") {
      const variantIds = product.variants.map((v) => v.id);
      const [orderItemCount, stockMovementCount] = await Promise.all([
        prisma.orderItem.count({ where: { variantId: { in: variantIds } } }),
        prisma.stockMovement.count({ where: { variantId: { in: variantIds } } }),
      ]);
      throw new ProductHasHistoryError(id, orderItemCount, stockMovementCount);
    }
    throw error;
  }
}

/**
 * Deletes a variant, blocked by last-variant-standing, remaining stock, or
 * order/stock history (design.md F4). Order: last-variant (unconditional,
 * different remedy in kind) -> onHand > 0 (not a foreign key, pre-checked)
 * -> attempt the delete, catch P2003 for history. Deliberately **no**
 * interactive `$transaction`: every writer that can raise `onHand` after
 * creation also writes a StockMovement, whose RESTRICT independently blocks
 * the delete — the onHand>0-with-no-movement state can only be left, never
 * entered, so there is no live TOCTOU window for this sequence to close.
 */
export async function deleteVariant(prisma: PrismaClient, variantId: string): Promise<void> {
  const variant = await prisma.variant.findUnique({ where: { id: variantId } });
  if (!variant) {
    throw new VariantNotFoundError(variantId);
  }

  const siblingCount = await prisma.variant.count({ where: { productId: variant.productId } });
  if (siblingCount === 1) {
    throw new LastVariantError(variant.productId, variantId);
  }

  if (variant.onHand > 0) {
    throw new VariantHasStockError(variantId, variant.sku, variant.onHand);
  }

  try {
    await prisma.variant.delete({ where: { id: variantId } });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2003") {
      const [orderItemCount, stockMovementCount] = await Promise.all([
        prisma.orderItem.count({ where: { variantId } }),
        prisma.stockMovement.count({ where: { variantId } }),
      ]);
      throw new VariantHasHistoryError(variantId, orderItemCount, stockMovementCount);
    }
    throw error;
  }
}

// No `onHand`/`held` field — structurally unwritable (F7: stock fields are
// owned exclusively by stock.service.ts).
export interface UpdateVariantInput {
  sku?: string;
  size?: string;
  color?: string;
}

/**
 * Updates a variant's `sku`, `size`, and/or `color` (design.md F5/F6).
 * `size`/`color` are rejected once the variant has any OrderItem row (F6,
 * 409-shaped: these ARE writable fields, just conflicted by current state).
 * The size+color pair is resolved (patch merged over current values,
 * mirroring `addVariant`'s `findFirst`) and pre-checked against every
 * sibling before the write, so a `P2002` surviving that check is
 * unambiguously the `sku` constraint (F5, see design.md Open Questions).
 */
export async function updateVariant(
  prisma: PrismaClient,
  variantId: string,
  input: UpdateVariantInput,
): Promise<Variant> {
  const variant = await prisma.variant.findUnique({ where: { id: variantId } });
  if (!variant) {
    throw new VariantNotFoundError(variantId);
  }

  if (input.size !== undefined || input.color !== undefined) {
    const orderItemCount = await prisma.orderItem.count({ where: { variantId } });
    if (orderItemCount > 0) {
      throw new VariantAttributesImmutableError(variantId, orderItemCount);
    }

    const resolvedSize = input.size ?? variant.size;
    const resolvedColor = input.color ?? variant.color;
    const collision = await prisma.variant.findFirst({
      where: {
        productId: variant.productId,
        size: resolvedSize,
        color: resolvedColor,
        NOT: { id: variantId },
      },
    });
    if (collision) {
      throw new DuplicateVariantError(variant.productId, resolvedSize, resolvedColor);
    }
  }

  try {
    return await prisma.variant.update({ where: { id: variantId }, data: input });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002") {
      throw new DuplicateSkuError(input.sku ?? "");
    }
    throw error;
  }
}

export type AdminProductRow = Product & {
  category: Category;
  variants: Variant[];
  images: ProductImage[];
};

/**
 * tasks.md 7.3 — lists EVERY product (unlike listCuratedProducts's `take`
 * limit or listProductsByCategory's per-category filter) with its category,
 * variants, and images, for the admin/productos table
 * (specs/admin-console/spec.md "Product and Variant Management").
 */
export async function listAllProductsForAdmin(prisma: PrismaClient): Promise<AdminProductRow[]> {
  return prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      category: true,
      variants: true,
      images: { orderBy: { position: "asc" } },
    },
  });
}
