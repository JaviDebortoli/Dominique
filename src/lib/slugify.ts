// Slug helpers shared by the admin category-creation form (client) and the
// POST /api/admin/categories route (server) — design.md C1: framework
// agnostic pure functions live in src/lib/ (see business-days.ts,
// format-price.ts for the same convention), so both sides apply the exact
// same rules with zero drift.
//
// Backs specs/admin-console/spec.md "Slug auto-suggestion strips accents"
// and "Invalid slug rejected before the database". tasks.md 1.1/1.2.

/**
 * Converts a display name into a URL-safe slug: Unicode-normalizes to NFD
 * (decomposing e.g. "ñ" into "n" + a combining tilde), strips every
 * combining diacritical mark, lowercases, then collapses every run of
 * non-alphanumeric characters into a single hyphen and trims leading/
 * trailing hyphens.
 *
 * The `u` (Unicode) regex flag is required for `\p{Diacritic}` to be
 * interpreted as a Unicode property escape — without it, `\p{...}` is not
 * special syntax and silently fails to match combining marks, leaving
 * accented bytes (or a dropped base letter) in the output.
 *
 * "Bijoutería" -> "bijouteria", "Ropa de Baño" -> "ropa-de-bano".
 */
export function toSlug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Validates that a value is ALREADY a well-formed slug: lowercase
 * alphanumeric segments joined by single hyphens, no leading/trailing/
 * doubled hyphens, no spaces, no accents. Used server-side in
 * POST /api/admin/categories to reject a hand-edited slug before any
 * database write (design.md C3/C4).
 */
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}
