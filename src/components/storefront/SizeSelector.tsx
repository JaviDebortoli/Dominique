"use client";

import { useState } from "react";

// Backs specs/storefront-browsing/spec.md:
//   - "Product Detail Page Variant Selector" (enable in-stock size, disable
//     zero-stock size, not selectable for purchase)
//   - "Locale and Copy" ("Sin stock" es-AR label, not an English placeholder)
// and tasks.md 3.4 (add-to-cart enabled only for a selected in-stock
// variant). This component is presentation-only: it owns selection state
// and exposes the chosen variant id via onAddToCart — actually adding it to
// a cart is Phase 4 (src/modules/cart/*), not wired here.
//
// DA-1 (design.md, confirmed by owner): no quantity input on the PDP.
// "Agregar al carrito" always adds exactly 1 unit. The cap against a
// variant's available stock is enforced as a disable-with-named-reason —
// once `inCartQty[selected.id]` already reaches `selected.available`, the
// button disables and its label names why instead of silently no-op'ing.

export interface SizeOption {
  id: string;
  size: string;
  available: number;
  isAvailable: boolean;
}

export interface SizeSelectorProps {
  variants: SizeOption[];
  onAddToCart?: (variantId: string) => void;
  /** variantId -> qty already in the cart, read server-side from the cart
   * cookie (producto/[slug]/page.tsx). Absent entries count as 0. */
  inCartQty?: Record<string, number>;
}

export function SizeSelector({ variants, onAddToCart, inCartQty = {} }: SizeSelectorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = variants.find((variant) => variant.id === selectedId) ?? null;
  const atCap = selected !== null && (inCartQty[selected.id] ?? 0) >= selected.available;
  const canAddToCart =
    selected !== null && selected.isAvailable && (inCartQty[selected.id] ?? 0) < selected.available;

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Talle" className="flex flex-wrap gap-3">
        {variants.map((variant) => {
          const isSelected = selectedId === variant.id;
          return (
            <div key={variant.id} className="flex flex-col items-center gap-1">
              <button
                type="button"
                disabled={!variant.isAvailable}
                aria-pressed={isSelected}
                onClick={() => setSelectedId(variant.id)}
                className={[
                  "flex h-12 w-12 items-center justify-center border font-sans text-body-md",
                  variant.isAvailable
                    ? isSelected
                      ? "border-ink bg-ink text-paper"
                      : "border-ink bg-paper text-ink hover:bg-surface-container"
                    : "cursor-not-allowed border-outline-variant bg-surface-container text-outline line-through",
                ].join(" ")}
              >
                {variant.size}
              </button>
              {!variant.isAvailable && (
                <span className="font-sans text-[10px] uppercase tracking-widest text-on-surface-variant">
                  Sin stock
                </span>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        disabled={!canAddToCart}
        onClick={() => selected && onAddToCart?.(selected.id)}
        className={[
          "w-full px-8 py-3 font-sans text-label-caps uppercase tracking-widest",
          canAddToCart
            ? "bg-nude text-ink hover:opacity-90"
            : "cursor-not-allowed bg-surface-container text-outline",
        ].join(" ")}
      >
        {atCap ? "Ya tenés el máximo disponible" : "Agregar al carrito"}
      </button>
    </div>
  );
}
