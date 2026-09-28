"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
//
// odd/tasks/comprar-ahora.md T1 — "Comprar ahora" buys the selected variant
// directly (qty 1), bypassing the cart entirely: it is enabled purely off
// `selected.isAvailable`, the in-cart cap above does NOT apply, and it
// navigates client-side (useRouter) to /checkout?variante=<id> instead of
// calling onAddToCart. Stock is re-validated server-side on that page/the
// submit; this button only gates on the already-known isAvailable flag.

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
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = variants.find((variant) => variant.id === selectedId) ?? null;
  const atCap = selected !== null && (inCartQty[selected.id] ?? 0) >= selected.available;
  const canAddToCart =
    selected !== null && selected.isAvailable && (inCartQty[selected.id] ?? 0) < selected.available;
  const canBuyNow = selected !== null && selected.isAvailable;

  function handleBuyNow() {
    if (!selected) return;
    router.push(`/checkout?variante=${encodeURIComponent(selected.id)}`);
  }

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
      <div className="flex flex-col gap-3">
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
        <button
          type="button"
          disabled={!canBuyNow}
          onClick={handleBuyNow}
          className={[
            "w-full border px-8 py-3 font-sans text-label-caps uppercase tracking-widest",
            canBuyNow
              ? "border-ink bg-paper text-ink hover:bg-surface-container"
              : "cursor-not-allowed border-outline-variant bg-surface-container text-outline",
          ].join(" ")}
        >
          Comprar ahora
        </button>
      </div>
    </div>
  );
}
