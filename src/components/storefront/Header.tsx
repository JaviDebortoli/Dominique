import Link from "next/link";
import type { CategoryTile } from "@/modules/catalog/category.service";

// Backs specs/storefront-browsing/spec.md:
//   - "Home Page Layout" ("navigation ... matching the mockup"). Markup
//     follows ejemplo/code.html's pickup banner + TopAppBar, with the nav
//     driven by real categories instead of the mockup's static placeholder
//     links.
//   - "Header Cart Entry Point": persistent cart icon linking to /carrito
//     with a server-derived item-count badge (design.md D2 — StoreLayout
//     reads the cart cookie and passes cartCount down; Header stays a
//     plain, synchronous, prop-tested presentational component).
export interface HeaderProps {
  categories: Pick<CategoryTile, "id" | "name" | "slug">[];
  /** Sum of qty across cart lines, read server-side from the cart cookie
   * (design.md D2) — never client-guessed. */
  cartCount: number;
}

export function Header({ categories, cartCount }: HeaderProps) {
  return (
    <>
      <div className="w-full bg-ink px-margin-mobile py-2 text-center">
        <p className="font-sans text-label-caps uppercase tracking-widest text-paper">
          Retiro exclusivo en local físico - Plata 192, Santiago del Estero
        </p>
      </div>
      <header className="sticky top-0 z-50 w-full border-b border-ink bg-surface">
        <div className="relative mx-auto flex w-full max-w-container flex-col items-center px-margin-mobile py-4 md:px-gutter">
          <Link
            href="/"
            className="mb-4 font-serif text-headline-lg-mobile uppercase tracking-widest text-ink md:text-headline-lg"
          >
            Dominique
          </Link>
          <Link
            href="/carrito"
            aria-label={`Carrito, ${cartCount} artículos`}
            className="absolute right-margin-mobile top-4 flex items-center gap-1 text-ink md:right-gutter"
          >
            {/* Hand-drawn 1px-stroke bag — matches the header's hairline
                vocabulary. Rejected: a filled circular badge (design.md
                Visual Design) — the loudest object in an all-hairline header. */}
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              className="stroke-ink"
              strokeWidth={1}
              aria-hidden="true"
            >
              <path d="M5 7h10l-1 10.5H6L5 7Z" />
              <path d="M7.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
            </svg>
            {cartCount > 0 ? (
              <span className="font-sans text-label-caps tracking-widest tabular-nums text-ink">
                {cartCount}
              </span>
            ) : null}
          </Link>
          <nav aria-label="Categorías" className="flex flex-wrap justify-center gap-8">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/categoria/${category.slug}`}
                className="font-sans text-label-caps text-on-surface-variant transition-opacity hover:opacity-70"
              >
                {category.name}
              </Link>
            ))}
          </nav>
        </div>
      </header>
    </>
  );
}
