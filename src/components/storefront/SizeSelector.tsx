"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Backs specs/storefront-browsing/spec.md:
//   - "Product Detail Page Variant Selector" (enable in-stock size, disable
//     zero-stock size, not selectable for purchase; size -> color two-step
//     selection with real-time per-variant stock)
//   - "Locale and Copy" ("Sin stock" es-AR label, not an English placeholder)
// and tasks.md 3.4 (add-to-cart enabled only for a selected in-stock
// variant). This component is presentation-only: it owns selection state
// and exposes the chosen variant id via onAddToCart — actually adding it to
// a cart is Phase 4 (src/modules/cart/*), not wired here.
//
// odd/tasks/selector-color.md T1 — each variant is a size+color pair.
// Selection is two steps: pick a distinct size (buttons deduped, order of
// first appearance; enabled when ANY variant of that size is available),
// then pick a color among that size's variants (each color button maps to
// exactly one variant; unavailable colors disabled "Sin stock"). When the
// selected size has exactly one color, it auto-selects so single-color
// products keep the old one-step flow. Changing size always resets the
// color choice, except when the new size re-triggers that same auto-select.
// Both purchase buttons act on the resulting size+color variant.
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
  color: string;
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
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Distinct sizes, order of first appearance (spec: stable ordering).
  const sizes = variants.reduce<string[]>(
    (acc, variant) => (acc.includes(variant.size) ? acc : [...acc, variant.size]),
    [],
  );
  const colorsForSelectedSize =
    selectedSize !== null ? variants.filter((variant) => variant.size === selectedSize) : [];

  const selected = variants.find((variant) => variant.id === selectedId) ?? null;
  const atCap = selected !== null && (inCartQty[selected.id] ?? 0) >= selected.available;
  const canAddToCart =
    selected !== null && selected.isAvailable && (inCartQty[selected.id] ?? 0) < selected.available;
  const canBuyNow = selected !== null && selected.isAvailable;

  function handleSelectSize(size: string) {
    setSelectedSize(size);
    const colorsForSize = variants.filter((variant) => variant.size === size);
    // Auto-select the only color for this size (single-color products
    // behave as today); otherwise clear the previous color choice.
    setSelectedId(colorsForSize.length === 1 ? colorsForSize[0].id : null);
  }

  function handleSelectColor(variantId: string) {
    setSelectedId(variantId);
  }

  function handleBuyNow() {
    if (!selected) return;
    router.push(`/checkout?variante=${encodeURIComponent(selected.id)}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Talle" className="flex flex-wrap gap-3">
        {sizes.map((size) => {
          const isSizeSelected = selectedSize === size;
          const isSizeAvailable = variants.some(
            (variant) => variant.size === size && variant.isAvailable,
          );
          return (
            <div key={size} className="flex flex-col items-center gap-1">
              <button
                type="button"
                disabled={!isSizeAvailable}
                aria-pressed={isSizeSelected}
                onClick={() => handleSelectSize(size)}
                className={[
                  "flex h-12 w-12 items-center justify-center border font-sans text-body-md",
                  isSizeAvailable
                    ? isSizeSelected
                      ? "border-ink bg-ink text-paper"
                      : "border-ink bg-paper text-ink hover:bg-surface-container"
                    : "cursor-not-allowed border-outline-variant bg-surface-container text-outline line-through",
                ].join(" ")}
              >
                {size}
              </button>
              {!isSizeAvailable && (
                <span className="font-sans text-[10px] uppercase tracking-widest text-on-surface-variant">
                  Sin stock
                </span>
              )}
            </div>
          );
        })}
      </div>
      {selectedSize !== null && (
        <div role="group" aria-label="Color" className="flex flex-wrap gap-3">
          {colorsForSelectedSize.map((variant) => {
            const isColorSelected = selectedId === variant.id;
            return (
              <div key={variant.id} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  disabled={!variant.isAvailable}
                  aria-pressed={isColorSelected}
                  onClick={() => handleSelectColor(variant.id)}
                  className={[
                    "flex h-12 min-w-12 items-center justify-center border px-4 font-sans text-body-md",
                    variant.isAvailable
                      ? isColorSelected
                        ? "border-ink bg-ink text-paper"
                        : "border-ink bg-paper text-ink hover:bg-surface-container"
                      : "cursor-not-allowed border-outline-variant bg-surface-container text-outline line-through",
                  ].join(" ")}
                >
                  {variant.color}
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
      )}
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
