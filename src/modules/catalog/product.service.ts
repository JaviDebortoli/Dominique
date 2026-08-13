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
