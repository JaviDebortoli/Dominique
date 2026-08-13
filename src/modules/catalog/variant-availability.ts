// Per-Variant Stock helper (specs/product-catalog/spec.md "Per-Variant
// Stock Field" and specs/inventory-stock/spec.md "Distinct Stock States").
//
// Pure functions only — no Prisma/DB access. `onHand`/`held` are only ever
// mutated by src/modules/inventory/stock.service.ts (design.md D2/D3); this
// module only reads and derives availability from those two counters so the
// storefront/admin can render "Sin stock" per variant without duplicating
// the available = onHand - held formula in multiple places.

export interface StockCounters {
  onHand: number;
  held: number;
}

export interface VariantStockSummary extends StockCounters {
  id: string;
  size: string;
  color: string;
  available: number;
  isAvailable: boolean;
}

/** available = onHand - held (design.md D2). Never negative in practice —
 * the DB CHECK constraints guarantee onHand >= 0 and held >= 0, and held
 * can never exceed onHand because every hold() is a conditional UPDATE. */
export function getAvailableStock({ onHand, held }: StockCounters): number {
  return onHand - held;
}

export function isVariantAvailable(counters: StockCounters): boolean {
  return getAvailableStock(counters) > 0;
}

/**
 * Per-variant availability breakdown for a product's variant list. Each
 * variant is evaluated independently, so one sold-out size never affects
 * the availability of sibling sizes/colors (spec: "One size sold out,
 * others available").
 */
export function summarizeVariantAvailability<
  T extends StockCounters & { id: string; size: string; color: string },
>(variants: T[]): VariantStockSummary[] {
  return variants.map((variant) => ({
    ...variant,
    available: getAvailableStock(variant),
    isAvailable: isVariantAvailable(variant),
  }));
}
