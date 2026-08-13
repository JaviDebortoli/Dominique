import Link from "next/link";
import type { CategoryTile as CategoryTileData } from "@/modules/catalog/category.service";

// Home page category entry point. Backs specs/storefront-browsing/spec.md
// "Home Page Layout" ("category entry points matching the mockup").
// Markup follows ejemplo/code.html's "Sección 2: Categorías" tiles.

export function CategoryTile({ category }: { category: CategoryTileData }) {
  return (
    <Link
      href={`/categoria/${category.slug}`}
      className="group relative block overflow-hidden border border-ink/10"
    >
      <div className="aspect-[3/4] overflow-hidden bg-surface-dim">
        {category.thumbnailUrl ? (
          // Admin-uploaded local files (design.md D8), not a remote domain.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={category.thumbnailUrl}
            // Decorative: the category name is already conveyed by the
            // visible <h3> caption below, in the same link. A repeated alt
            // here would double the link's accessible name.
            alt=""
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : null}
      </div>
      <div className="absolute bottom-6 left-6">
        <h3 className="font-serif text-headline-md text-ink bg-paper/80 px-2">
          {category.name}
        </h3>
      </div>
    </Link>
  );
}
