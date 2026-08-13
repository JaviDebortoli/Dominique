import { describe, expect, it } from "vitest";
import { formatPriceARS } from "./format-price";

describe("formatPriceARS", () => {
  it("formats an integer amount as Argentine pesos", () => {
    expect(formatPriceARS(15000)).toBe("$15.000");
  });

  it("rounds fractional amounts to the nearest peso", () => {
    expect(formatPriceARS(999.6)).toBe("$1.000");
  });

  it("formats zero", () => {
    expect(formatPriceARS(0)).toBe("$0");
  });
});
