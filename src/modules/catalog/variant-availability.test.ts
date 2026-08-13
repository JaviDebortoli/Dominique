import { describe, expect, it } from "vitest";
import {
  getAvailableStock,
  isVariantAvailable,
  summarizeVariantAvailability,
} from "./variant-availability";

describe("getAvailableStock (pure)", () => {
  it("subtracts held from onHand", () => {
    expect(getAvailableStock({ onHand: 5, held: 2 })).toBe(3);
  });

  it("returns 0 when everything on hand is held", () => {
    expect(getAvailableStock({ onHand: 3, held: 3 })).toBe(0);
  });
});

describe("isVariantAvailable (pure)", () => {
  it("is available when available stock is greater than zero", () => {
    expect(isVariantAvailable({ onHand: 4, held: 1 })).toBe(true);
  });

  it("is NOT available when onHand equals held (sold out)", () => {
    expect(isVariantAvailable({ onHand: 2, held: 2 })).toBe(false);
  });
});

describe("summarizeVariantAvailability — Per-Variant Stock scenario", () => {
  it("marks only the sold-out size unavailable, S and L remain purchasable", () => {
    const variants = [
      { id: "v-s", size: "S", color: "Negro", onHand: 5, held: 0 },
      { id: "v-m", size: "M", color: "Negro", onHand: 3, held: 3 }, // sold out
      { id: "v-l", size: "L", color: "Negro", onHand: 2, held: 0 },
    ];

    const summary = summarizeVariantAvailability(variants);

    expect(summary).toHaveLength(3);
    const bySize = new Map(summary.map((s) => [s.size, s]));

    expect(bySize.get("S")?.isAvailable).toBe(true);
    expect(bySize.get("S")?.available).toBe(5);

    expect(bySize.get("M")?.isAvailable).toBe(false);
    expect(bySize.get("M")?.available).toBe(0);

    expect(bySize.get("L")?.isAvailable).toBe(true);
    expect(bySize.get("L")?.available).toBe(2);
  });
});
