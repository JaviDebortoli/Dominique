import Link from "next/link";
import type { CategoryTile } from "@/modules/catalog/category.service";
import { CategoryMenu } from "./CategoryMenu";

// Backs specs/storefront-browsing/spec.md:
//   - "Home Page Layout" ("navigation ... matching the mockup"). Markup
//     follows ejemplo/code.html's pickup banner + TopAppBar. The category
//     nav itself now lives in the top-right CategoryMenu dropdown rather
//     than a static row under the wordmark — same categories, same links,
//     collapsed by default.
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
        <div className="relative mx-auto flex w-full max-w-container flex-wrap items-center justify-between gap-y-2 px-margin-mobile py-4 md:flex-nowrap md:justify-center md:px-gutter">
          <div className="flex items-center gap-3">
            {/* Circular "D" emblem, pinned to the left margin — mirrors the
                right-side cluster. Sits beside the wordmark in normal flow
                below md; absolute-anchored to the header's left edge at md
                and up, leaving the wordmark centered on its own. alt=""
                (decorative): the emblem's own arced "DOMINIQUE / TALLES
                REALES" micro-text is illegible at this size by design. Its
                home link carries a distinct accessible name so it doesn't
                collide with the wordmark's "Dominique" link. */}
            <Link
              href="/"
              aria-label="Página de inicio"
              className="flex shrink-0 items-center md:absolute md:left-gutter md:top-1/2 md:-translate-y-1/2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/logo.svg"
                alt=""
                width={1536}
                height={1503}
                className="h-11 w-auto md:h-14"
              />
            </Link>

            <Link
              href="/"
              className="font-serif text-headline-lg-mobile uppercase tracking-widest text-ink md:text-headline-lg"
            >
              Dominique
            </Link>
          </div>
          {/* Below md the cluster stays in normal flow (design.md "Resolved:
              Mobile Header Layout") so it can never overlap the centered
              wordmark at ~320px; flex-wrap drops it to its own row when the
              two boxes don't fit side by side. At md and up it returns to the
              absolute-anchored right position over the centered wordmark. */}
          <div className="flex items-center gap-6 md:absolute md:right-gutter md:top-1/2 md:-translate-y-1/2">
            <CategoryMenu categories={categories} />
            <Link
              href="/carrito"
              aria-label={`Carrito, ${cartCount} artículos`}
              className="flex items-center gap-1 text-ink"
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
          </div>
        </div>
      </header>
    </>
  );
}
