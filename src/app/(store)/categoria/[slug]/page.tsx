import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  getCategoryBySlug,
  listProductsByCategory,
} from "@/modules/catalog/category.service";
import { ProductCard } from "@/components/storefront/ProductCard";

// Category listing page. Backs specs/storefront-browsing/spec.md "Category
// Listing": "the system SHALL list those products with price and thumbnail
// image" for every active product assigned to the browsed category (see
// category.service.ts for the "active" wording note). Reads Prisma/services
// directly (design.md D1).
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const category = await getCategoryBySlug(prisma, slug);
  if (!category) {
    notFound();
  }

  const products = await listProductsByCategory(prisma, slug);

  return (
    <section className="mx-auto max-w-container px-margin-mobile py-section md:px-gutter">
      <div className="mb-12 border-b border-ink pb-4">
        <h1 className="font-serif text-headline-md text-ink md:text-headline-lg">
          {category.name}
        </h1>
      </div>
      {products.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-12 md:grid-cols-4 md:gap-8">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={{
                slug: product.slug,
                name: product.name,
                price: Number(product.price),
                thumbnailUrl: product.images[0]?.url ?? null,
                thumbnailAlt: product.images[0]?.altText ?? null,
              }}
            />
          ))}
        </div>
      ) : (
        <p className="font-sans text-body-md text-on-surface-variant">
          Todavía no hay productos en esta categoría.
        </p>
      )}
    </section>
  );
}
