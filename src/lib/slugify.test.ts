import { describe, expect, it } from "vitest";
import { isValidSlug, toSlug } from "./slugify";

// Pure functions, no DB — mirrors business-days.test.ts's convention.
// Backs specs/admin-console/spec.md "Slug auto-suggestion strips accents"
// and "Invalid slug rejected before the database" (design.md C1/C4).
// tasks.md 1.1/1.2.
describe("toSlug", () => {
  it("kebab-cases a plain accented name (Bijoutería -> bijouteria)", () => {
    expect(toSlug("Bijoutería")).toBe("bijouteria");
  });

  it("kebab-cases a multi-word accented name (Ropa de Baño -> ropa-de-bano)", () => {
    expect(toSlug("Ropa de Baño")).toBe("ropa-de-bano");
  });

  it("strips the ñ specifically — NFD-decomposes to n + combining tilde, must not survive as ñ or vanish", () => {
    const result = toSlug("Baño");
    expect(result).toBe("bano");
    // Guard against the failure mode where \p{Diacritic} without the `u`
    // flag silently fails to match the combining tilde: the raw ñ byte
    // must not leak through, and the base letter must not be dropped
    // entirely (e.g. "bo").
    expect(result).not.toContain("ñ");
    expect(result).toHaveLength(4);
  });

  it("collapses punctuation and ampersands into a single hyphen", () => {
    expect(toSlug("Ropa & Accesorios!!")).toBe("ropa-accesorios");
  });

  it("trims leading and trailing hyphens and collapses internal runs", () => {
    expect(toSlug("  --Calzado   Deportivo--  ")).toBe("calzado-deportivo");
  });

  it("is idempotent — applying toSlug to its own output returns the same value", () => {
    const once = toSlug("Bijoutería & Accesorios");
    expect(toSlug(once)).toBe(once);
  });
});

describe("isValidSlug", () => {
  it("accepts a well-formed slug", () => {
    expect(isValidSlug("bijouteria")).toBe(true);
  });

  it("accepts a well-formed multi-word slug", () => {
    expect(isValidSlug("ropa-de-bano")).toBe(true);
  });

  it("rejects uppercase letters", () => {
    expect(isValidSlug("Bijouteria")).toBe(false);
  });

  it("rejects spaces", () => {
    expect(isValidSlug("ropa interior")).toBe(false);
  });

  it("rejects accented characters", () => {
    expect(isValidSlug("bijouteria-ñ")).toBe(false);
  });

  it("rejects a leading hyphen", () => {
    expect(isValidSlug("-bijouteria")).toBe(false);
  });

  it("rejects a trailing hyphen", () => {
    expect(isValidSlug("bijouteria-")).toBe(false);
  });

  it("rejects a double hyphen", () => {
    expect(isValidSlug("ropa--interior")).toBe(false);
  });
});
