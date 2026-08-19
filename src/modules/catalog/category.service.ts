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

// Category edit/delete path — admin-categorias-edicion change (design.md
// E1-E4). Mirrors DuplicateCategorySlugError's shape.
export class DuplicateCategoryNameError extends Error {
  constructor(public readonly name: string) {
    super(`A category named "${name}" already exists.`);
    this.name = "DuplicateCategoryNameError";
  }
}

export class CategoryNotFoundError extends Error {
  constructor(public readonly categoryId: string) {
    super(`Category ${categoryId} not found.`);
    this.name = "CategoryNotFoundError";
  }
}

export class CategoryHasProductsError extends Error {
  constructor(
    public readonly categoryId: string,
    public readonly productCount: number,
  ) {
    super(`Category ${categoryId} still has ${productCount} product(s) assigned.`);
    this.name = "CategoryHasProductsError";
  }
}

// No `slug` field — structurally unwritable (design.md E1/E2/E4: rename
// changes `name` only, `slug` is immutable after creation).
export interface RenameCategoryInput {
  name: string;
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

/**
 * Renames only `name`. `slug` is never written (proposal: immutable, zero
 * exceptions). Pre-checks for a case-insensitive collision against every
 * OTHER category (design.md E1/E2: `name` has no DB-level unique constraint,
 * so a read is the only enforcement available; excluding the row's own id
 * allows a case-only self-rename, e.g. "Bijou" -> "bijou").
 *
 * Uses `findMany` + `toLocaleLowerCase()` comparison in JS, not
 * `equals`/`mode: "insensitive"` — confirmed at implementation time
 * (design.md's Open Questions) that Prisma's Postgres connector compiles
 * `mode: "insensitive"` to `ILIKE`, which treats `%`/`_` in the compared
 * value as wildcards and would falsely collide a name containing one of
 * those characters. Safe here: the admin page already renders every
 * category row (small table, no pagination).
 *
 * Throws CategoryNotFoundError (P2025) if the id does not exist.
 */
export async function renameCategory(
  prisma: PrismaClient,
  id: string,
  input: RenameCategoryInput,
): Promise<Category> {
  const others = await prisma.category.findMany({
    where: { NOT: { id } },
    select: { id: true, name: true },
  });
  const targetName = input.name.toLocaleLowerCase();
  const collision = others.some((other) => other.name.toLocaleLowerCase() === targetName);
  if (collision) {
    throw new DuplicateCategoryNameError(input.name);
  }

  try {
    return await prisma.category.update({
      where: { id },
      data: { name: input.name },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "P2025"
    ) {
      throw new CategoryNotFoundError(id);
    }
    throw error;
  }
}

/**
 * Deletes an empty category. The FK's `ON DELETE RESTRICT` (Prisma's
 * default for a required relation) is the single authority for whether the
 * delete is blocked (design.md E3): attempt the delete, and only on a
 * P2003 failure count the referencing products for the error message — the
 * count never gates the decision, it only explains it.
 */
export async function deleteCategory(prisma: PrismaClient, id: string): Promise<void> {
  try {
    await prisma.category.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "P2003") {
        const productCount = await prisma.product.count({ where: { categoryId: id } });
        throw new CategoryHasProductsError(id, productCount);
      }
      if (code === "P2025") {
        throw new CategoryNotFoundError(id);
      }
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
