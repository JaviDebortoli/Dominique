# Design: Admin Category Creation

## Technical Approach

A composition on top of the archived `dominique-ecommerce` design's **D1** (modular monolith: business rules in `src/modules/*`, routes are thin adapters) and **D7** (`/api/admin/*` sits outside `src/proxy.ts`'s matcher and checks its own session). No new architectural decisions, no new D-numbers — the decisions below (C1–C5) record only *how* this slice composes with the shipped ones.

Three layers, each mirroring an existing file: a pure slug helper in `src/lib/`, a write path added to `category.service.ts` (mirroring `createProduct`/`DuplicateVariantError`), and a POST adapter mirroring `api/admin/products/route.ts`. UI is one RSC page with a colocated client form.

## Architecture Decisions

| # | Choice | Rejected alternative | Rationale |
|---|---|---|---|
| C1 | Slug logic lives in `src/lib/slugify.ts` as two pure functions, `toSlug(name)` and `isValidSlug(slug)` | (a) inside `category.service.ts`; (b) duplicated in form + route | `src/lib/business-days.ts` and `format-price.ts` already establish `src/lib/` as the home for framework-agnostic pure helpers. The client form and the server route need the *same* rules; (a) would force a `"use client"` component to import a Prisma-typed module, (b) guarantees drift |
| C2 | `createCategory` relies solely on catching Prisma `P2002` — no pre-check `findUnique` | `findUnique` then `create` (the shape `addVariant` uses) | `slug @unique` is a single-column DB constraint and is race-free; `addVariant`'s pre-check exists to give a better message for the *intra-payload* duplicate case, which has no analogue here. A pre-check adds a round-trip and a TOCTOU window the catch must handle anyway |
| C3 | Slug **format** is validated in the route adapter (`isValidSlug` → 400); slug **uniqueness** is enforced in the service (typed error → 409) | Re-validating format in the service with a second typed error | Matches the shipped split: `api/admin/products/route.ts`'s `validateBody` owns input shape, `product.service.ts` owns invariants. A second typed error would produce no distinct caller behavior. `createCategory`'s JSDoc states the precondition explicitly |
| C4 | Distinct error codes `invalid_slug` and `duplicate_slug`, not one generic `invalid_request` | Reuse `invalid_request` for everything | The owner must know *which* field is wrong and why; the form renders the server `message` verbatim |
| C5 | Single page: list + inline form, `router.refresh()` on success, no redirect and no separate `/nuevo` route | Mirror `productos/nuevo/` as a second route with `router.push` | Creating a category is one field pair, not a multi-step form; staying put lets the owner add "Bijou", "Calzado", "Accesorios" in a row and see each land in the list above |

## Data Flow

    NewCategoryForm (client)          POST /api/admin/categories        category.service
      name ─toSlug()→ slug preview      auth() ──401                      createCategory()
      fetch(JSON) ────────────────────→ isValidSlug ──400 invalid_slug  → prisma.category.create
                                        └──────────────────────────────→   catch P2002
      router.refresh() ←── 201 {id,name,slug}                              → DuplicateCategorySlugError → 409
              │
              └→ RSC page re-renders ← listAllCategoriesForAdmin(prisma)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/slugify.ts` | Create | `toSlug` (NFD-normalize, strip `\p{Diacritic}`, lowercase, non-alphanumerics → single `-`, trim hyphens) + `isValidSlug` (`/^[a-z0-9]+(-[a-z0-9]+)*$/`) |
| `src/lib/slugify.test.ts` | Create | Unit tests, no DB |
| `src/modules/catalog/category.service.ts` | Modify | Add `DuplicateCategorySlugError`, `CreateCategoryInput`, `createCategory`, `AdminCategoryRow`, `listAllCategoriesForAdmin` |
| `src/modules/catalog/category.service.test.ts` | Modify | Extend existing integration suite |
| `src/app/api/admin/categories/route.ts` | Create | POST adapter |
| `src/app/api/admin/categories/route.test.ts` | Create | HTTP-level tests with `makeAuthMockModule()` |
| `src/app/admin/(console)/categorias/page.tsx` | Create | RSC list + empty state, renders the form |
| `src/app/admin/(console)/categorias/NewCategoryForm.tsx` | Create | Client form |
| `src/app/admin/(console)/categorias/NewCategoryForm.test.tsx` | Create | Slug auto-fill / manual-edit / error-render tests |
| `src/app/admin/(console)/layout.tsx` | Modify | `Categorías` nav link between Productos and Pedidos; **and** fix the stale `middleware.ts` doc reference → `src/proxy.ts` |
| `src/app/api/admin/products/route.ts` | Modify | Comment-only: stale `src/middleware.ts` → `src/proxy.ts` |

**Drive-by fix — included in this change, not deferred.** Both are comment-only (+0 behavior). `layout.tsx` is already modified for the nav link. `api/admin/products/route.ts` is the file the new route's doc comment is copied from, so leaving it stale would propagate the wrong convention name into a brand-new file. One task, two lines.

## Interfaces / Contracts

```ts
// src/lib/slugify.ts
export function toSlug(input: string): string;      // "Bijoutería" → "bijouteria"
export function isValidSlug(value: string): boolean; // /^[a-z0-9]+(-[a-z0-9]+)*$/

// src/modules/catalog/category.service.ts
export class DuplicateCategorySlugError extends Error {
  constructor(public readonly slug: string); // this.name = "DuplicateCategorySlugError"
}
export interface CreateCategoryInput { name: string; slug: string }
/** Precondition: `slug` is already format-valid (see isValidSlug) — the adapter validates. */
export function createCategory(prisma: PrismaClient, input: CreateCategoryInput): Promise<Category>;

export interface AdminCategoryRow { id: string; name: string; slug: string; productCount: number }
/** Ordered by name asc; productCount via `_count: { select: { products: true } }`. */
export function listAllCategoriesForAdmin(prisma: PrismaClient): Promise<AdminCategoryRow[]>;
```

**`POST /api/admin/categories`** — body `{ name: string, slug: string }`; both trimmed before validation.

| Status | Body | When |
|---|---|---|
| 201 | `{ id, name, slug }` | Created |
| 400 | `{ error: "invalid_request" }` | Unparseable JSON, or `name`/`slug` missing or empty after trim |
| 400 | `{ error: "invalid_slug", message }` | Fails `isValidSlug` (uppercase, spaces, accents, edge/double hyphen) |
| 401 | `{ error: "unauthenticated" }` | No `auth()` session |
| 409 | `{ error: "duplicate_slug", message }` | `DuplicateCategorySlugError` |

Anything else rethrows (Next.js 500), exactly as the products route does.

## UI Shape

No new visual direction: existing Editorial Minimalist tokens only (`bg-nude` submit, `border-ink/20` inputs, `font-sans text-label-caps uppercase tracking-widest`, `text-red-700` + `role="alert"`). Table columns `Categoría | Slug | Productos` mirror `productos/page.tsx`. Empty state is an invitation, not a shrug: "Todavía no hay categorías. Creá la primera acá abajo."

The one deliberate detail: under the slug field, a live preview of the resulting public URL (`/categoria/bijouteria`). Slug mistakes are the actual failure mode this slice guards against, so the consequence of the field is shown rather than described. `slug` auto-follows `name` through `toSlug` until the owner edits it by hand (`slugTouched` flag), then stops. On 201 the form clears all three pieces of state and calls `router.refresh()`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `toSlug` accents (`Bijoutería`→`bijouteria`, `Ropa de Baño`→`ropa-de-bano`), `ñ`, `&`/punctuation, collapsed and trimmed hyphens, idempotence; `isValidSlug` rejects uppercase, spaces, accents, leading/trailing/double hyphens | vitest, pure, no DB — mirrors `business-days.test.ts` |
| Integration (service) | `createCategory` persists; duplicate slug throws `DuplicateCategorySlugError` and writes nothing; `listAllCategoriesForAdmin` returns `productCount` and name ordering | Real Postgres, `randomUUID()` suffixes, `afterAll` cleanup of created ids — mirrors `product.service.test.ts` |
| Integration (route) | 401 writes nothing; 400 `invalid_slug` for `Ropa Interior`/`Bijoutería`; 400 `invalid_request` for empty name; 409 on duplicate; 201 body shape | `vi.mock("@/lib/auth", () => makeAuthMockModule())` + real Postgres — mirrors `api/admin/products/route.test.ts` |
| Component | Slug auto-fills from name; stops after manual slug edit; server `message` renders in `role="alert"`; fields clear on success | `@testing-library/react` + `user-event`, `fetch` stubbed — mirrors `CheckoutForm.test.tsx` |
| E2E | Owner creates a category and it appears in the product form's picker (Success Criteria #2) | Recommended, one Playwright spec following the existing `e2e/admin-*` pattern |

## Threat Matrix

N/A — every row in `references/threat-matrix.md` covers a VCS/shell/subprocess/PR-automation or executable-file-classification boundary. This change adds one HTTP route inside the existing Next.js App Router, gated by the same `auth()` call as the shipped `/api/admin/*` routes, and touches no shell, subprocess, git invocation, or file classification. The adversarial cases that *do* exist here (unauthenticated POST, hostile slug, duplicate slug) are route-contract cases and are covered as required tests in the Testing Strategy above.

## Migration / Rollout

No migration required. Purely additive: no schema change, no change to any existing read path or to product creation. Rollback is reverting the PR; already-created rows are ordinary `Category` rows, indistinguishable from seeded ones.

## Open Questions

None blocking. Rename/edit remains out of scope per the proposal's resolved decisions; revisit after apply.
