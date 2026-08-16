// Catalog module — category read path (design.md D1).
//
// Backs specs/product-catalog/spec.md "Category Association": every product
// belongs to exactly one category (enforced structurally by the required,
// non-nullable Product.categoryId relation in schema.prisma), and browsing
// a category SHALL only list products assigned to it.
//
// Also backs specs/storefront-browsing/spec.md:
//   - "Category Listing" (products with price + thumbnail)
//   - "Home Page Layout" (category entry points with a representative image)
//
// Note on "active products" (storefront-browsing spec wording): the schema
// has no isActive/archived/draft field on Product (see prisma/schema.prisma
// and design.md's Data Model Sketch — no such column was ever introduced),
// and no task/spec in this change introduces one. Every persisted Product
// row is therefore treated as active; this keeps the Phase 2 filtering
// behavior of listProductsByCategory unchanged (see product-catalog spec's
// "Category Association" test, still passing).

import type { Category, PrismaClient, Product, ProductImage } from "@/generated/prisma/client";

// Category write path — admin-categorias change (design.md C1/C2/C3).
// Mirrors product.service.ts's createProduct/DuplicateVariantError shape:
// the module owns the invariant (slug uniqueness), the route owns request
// shape validation.
export class DuplicateCategorySlugError extends Error {
  constructor(public readonly slug: string) {
    super(`A category with slug "${slug}" already exists.`);
    this.name = "DuplicateCategorySlugError";
  }
}

export interface CreateCategoryInput {
  name: string;
  slug: string;
}

/**
 * Creates a category. Precondition: `slug` is already format-valid (see
 * `isValidSlug` in src/lib/slugify.ts) — the route adapter validates format
 * before calling this. Relies solely on the DB's `slug @unique` constraint
 * (Prisma error code P2002) to detect a duplicate, rather than a pre-check
 * `findUnique` (design.md C2: race-free, avoids an extra round-trip and the
 * TOCTOU window a pre-check would still need to handle via catch anyway).
 */
export async function createCategory(
  prisma: PrismaClient,
  input: CreateCategoryInput,
): Promise<Category> {
  try {
    return await prisma.category.create({
      data: { name: input.name, slug: input.slug },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      throw new DuplicateCategorySlugError(input.slug);
    }
    throw error;
  }
}

export interface AdminCategoryRow {
  id: string;
  name: string;
  slug: string;
  productCount: number;
}

/**
 * Lists every category with its product count, ordered by name asc, for
 * the /admin/categorias list page (specs/admin-console/spec.md "Product and
 * Variant Management").
 */
export async function listAllCategoriesForAdmin(
  prisma: PrismaClient,
): Promise<AdminCategoryRow[]> {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    productCount: category._count.products,
  }));
}

export async function getCategoryBySlug(
  prisma: PrismaClient,
  slug: string,
): Promise<Category | null> {
  return prisma.category.findUnique({ where: { slug } });
}

export type ProductListItem = Product & { images: ProductImage[] };

/**
 * Lists the products assigned to a single category, identified by slug,
 * each with its first image (thumbnail) for the storefront listing.
 * Returns an empty array both when the category has no products and when
 * the slug does not resolve to any category — callers that need to
 * distinguish "unknown category" from "empty category" should call
 * `getCategoryBySlug` first.
 */
export async function listProductsByCategory(
  prisma: PrismaClient,
  categorySlug: string,
): Promise<ProductListItem[]> {
  return prisma.product.findMany({
    where: { category: { slug: categorySlug } },
    orderBy: { createdAt: "desc" },
    include: { images: { orderBy: { position: "asc" }, take: 1 } },
  });
}

export interface CategoryTile {
  id: string;
  name: string;
  slug: string;
  thumbnailUrl: string | null;
}

/**
 * Lists every category with a representative thumbnail image, sourced from
 * its newest product's first image (there is no dedicated Category image
 * field in the schema — see design.md's Data Model Sketch). Used for the
 * home page's category entry points (storefront-browsing "Home Page
 * Layout"). `thumbnailUrl` is null for a category with no products yet.
 */
export async function listCategoriesWithThumbnail(
  prisma: PrismaClient,
): Promise<CategoryTile[]> {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      products: {
        take: 1,
        orderBy: { createdAt: "desc" },
        include: { images: { orderBy: { position: "asc" }, take: 1 } },
      },
    },
  });

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    thumbnailUrl: category.products[0]?.images[0]?.url ?? null,
  }));
}
