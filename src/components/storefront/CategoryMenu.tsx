"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CategoryTile } from "@/modules/catalog/category.service";

// Top-right dropdown replacement for the category row that used to sit
// below the "Dominique" wordmark (Header.tsx). Split out as its own client
// component so Header itself stays a plain, synchronous, prop-tested
// presentational component (design.md D2) — only this menu owns
// open/close state.
export interface CategoryMenuProps {
  categories: Pick<CategoryTile, "id" | "name" | "slug">[];
}

export function CategoryMenu({ categories }: CategoryMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (categories.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 font-sans text-label-caps uppercase tracking-widest text-ink transition-opacity hover:opacity-70"
      >
        Categorías
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          className={`stroke-ink transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.2}
          aria-hidden="true"
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <nav
          aria-label="Categorías"
          className="absolute right-0 top-full z-50 mt-3 flex min-w-[180px] flex-col border border-ink bg-paper py-2"
        >
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/categoria/${category.slug}`}
              onClick={() => setOpen(false)}
              className="px-4 py-2 font-sans text-label-caps text-on-surface-variant transition-opacity hover:opacity-70"
            >
              {category.name}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
