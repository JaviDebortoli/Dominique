import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getProductBySlug } from "@/modules/catalog/product.service";
import { summarizeVariantAvailability } from "@/modules/catalog/variant-availability";
import { formatPriceARS } from "@/lib/format-price";
import { SizeSelector } from "@/components/storefront/SizeSelector";
import { addOneToCart } from "@/modules/cart/cart-cookie";

// Product Detail Page. Backs specs/storefront-browsing/spec.md:
//   - "Product Detail Page Variant Selector" (enable in-stock, disable
//     zero-stock)
//   - "Locale and Copy" ("Sin stock" es-AR label)
// Reads Prisma/services directly (design.md D1); per-variant availability
// is computed via the Phase 2 pure-function helper (variant-availability.ts)
// so the "available = onHand - held" formula lives in exactly one place.
export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const product = await getProductBySlug(prisma, slug);
  if (!product) {
    notFound();
  }

  const variantOptions = summarizeVariantAvailability(product.variants).map(
    (variant) => ({
      id: variant.id,
      size: variant.size,
      available: variant.available,
      isAvailable: variant.isAvailable,
    }),
  );

  const primaryImage = product.images[0];

  return (
    <section className="mx-auto grid max-w-container grid-cols-1 gap-gutter px-margin-mobile py-section md:grid-cols-2 md:px-gutter">
      <div className="aspect-[1/1.5] overflow-hidden border border-ink/10 bg-surface-container">
        {primaryImage ? (
          // Admin-uploaded local files (design.md D8), not a remote domain.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={primaryImage.url}
            alt={primaryImage.altText ?? product.name}
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-6">
        <h1 className="font-serif text-headline-lg-mobile text-ink md:text-headline-lg">
          {product.name}
        </h1>
        <p className="font-sans text-price-display text-ink">
          {formatPriceARS(Number(product.price))}
        </p>
        {product.description ? (
          <p className="font-sans text-body-md text-on-surface-variant">
            {product.description}
          </p>
        ) : null}
        <SizeSelector variants={variantOptions} onAddToCart={addOneToCart} />
      </div>
    </section>
  );
}
