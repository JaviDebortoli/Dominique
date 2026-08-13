import Link from "next/link";
import type { CategoryTile } from "@/modules/catalog/category.service";

// Backs specs/storefront-browsing/spec.md "Home Page Layout" ("navigation
// ... matching the mockup"). Markup follows ejemplo/code.html's pickup
// banner + TopAppBar, with the nav driven by real categories instead of the
// mockup's static placeholder links.

export function Header({ categories }: { categories: Pick<CategoryTile, "id" | "name" | "slug">[] }) {
  return (
    <>
      <div className="w-full bg-ink px-margin-mobile py-2 text-center">
        <p className="font-sans text-label-caps uppercase tracking-widest text-paper">
          Retiro exclusivo en local físico - Plata 192, Santiago del Estero
        </p>
      </div>
      <header className="sticky top-0 z-50 w-full border-b border-ink bg-surface">
        <div className="mx-auto flex w-full max-w-container flex-col items-center px-margin-mobile py-4 md:px-gutter">
          <Link
            href="/"
            className="mb-4 font-serif text-headline-lg-mobile uppercase tracking-widest text-ink md:text-headline-lg"
          >
            Dominique
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
