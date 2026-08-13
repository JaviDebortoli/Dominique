import Link from "next/link";
import { formatPriceARS } from "@/lib/format-price";

// Product card used on the home page's curated section and the category
// listing page. Backs specs/storefront-browsing/spec.md "Category Listing"
// (price + thumbnail) and "Home Page Layout" (curated product sections).
// Markup/structure follows ejemplo/code.html's "Sección 4: Productos
// Destacados" product card.

export interface ProductCardData {
  slug: string;
  name: string;
  price: number;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <Link
      href={`/producto/${product.slug}`}
      className="group flex flex-col"
    >
      <div className="relative mb-4 aspect-[1/1.5] overflow-hidden border border-ink/10 bg-surface-container">
        {product.thumbnailUrl ? (
          // Admin-uploaded local files (design.md D8), not a configured
          // remote image domain, so next/image's optimizer doesn't apply.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.thumbnailUrl}
            // Falls back to "" (decorative), not product.name: the visible
            // <h3> right below already conveys the name in this same link
            // — repeating it in alt would double the link's accessible
            // name (see CategoryTile.tsx for the same rule).
            alt={product.thumbnailAlt ?? ""}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : null}
      </div>
      <h3 className="mb-1 font-serif text-[18px] leading-tight text-ink">
        {product.name}
      </h3>
      <p className="mt-auto font-sans text-price-display text-ink">
        {formatPriceARS(product.price)}
      </p>
    </Link>
  );
}
