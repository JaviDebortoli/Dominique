# Exploration: Admin category edit + delete

## Current State

Category **creation** shipped in `openspec/changes/archive/2026-08-16-admin-categorias/`; its design.md explicitly deferred edit/delete ("Rename/edit remains out of scope per the proposal's resolved decisions; revisit after apply" — this change is that revisit).

Three-layer pattern already in place (verified on disk), create-only:

- `src/lib/slugify.ts` — `toSlug(name)`, `isValidSlug(slug)`, shared client/server.
- `src/modules/catalog/category.service.ts` — `createCategory` (catches Prisma `P2002` → `DuplicateCategorySlugError`), `listAllCategoriesForAdmin`, `getCategoryBySlug`, `listProductsByCategory`, `listCategoriesWithThumbnail`. Module doc states the hard invariant: every product belongs to exactly one category.
- `src/app/api/admin/categories/route.ts` — POST only, `auth()` 401, `isValidSlug` 400, `DuplicateCategorySlugError` → 409, else rethrow → Next 500. Sits outside `src/proxy.ts`'s matcher (own session check, JSON not redirect).
- `src/app/admin/(console)/categorias/page.tsx` — RSC table (`Categoría | Slug | Productos`), no edit/delete affordance in rows.
- `src/app/admin/(console)/categorias/NewCategoryForm.tsx` — slug auto-follows `name` via `toSlug()` until `slugTouched`; POST + `router.refresh()`, no redirect (design.md C5).

## Fact-checks against the open questions

**1. Delete-with-products Prisma behavior — resolved.** `prisma/migrations/20260812231809_init/migration.sql:213`: `ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;` — explicit `ON DELETE RESTRICT`. Deleting a `Category` with existing `Product` rows raises a Postgres FK violation, surfaced by Prisma Client as error code **P2003**. This is the exact same shape as the already-used `P2002`-catch pattern in `createCategory` — a parallel error class (e.g. `CategoryHasProductsError`) can catch `P2003` in `deleteCategory`, mirroring design.md's C2 precedent.

**2. Block vs. reassign — no fallback category exists.** `Product.categoryId` is required/non-nullable, no default/"Uncategorized" category seeded anywhere, no reassignment mechanism in the codebase today. Blocking delete-when-has-products needs zero new schema/UI and matches the existing invariant. Reassignment (bulk-picker, nullable relation, or seeded fallback category) is materially larger scope — flagged as an explicit decision, not defaulted.

**3. Slug-change risk — confirmed real gap, no precedent to reuse.** `src/app/(store)/categoria/[slug]/page.tsx` resolves purely by slug via `getCategoryBySlug`, no ID fallback. Grep for `redirect|alias|previousSlug|oldSlug` across `src/` found zero category-related hits — no redirect/alias mechanism exists anywhere in this codebase. Changing `slug` post-creation will silently 404 any previously bookmarked/shared `/categoria/{old-slug}` URL.

**4. Spec vs. reality gap.** `openspec/specs/admin-console/spec.md` "Product and Variant Management" already says in prose "Staff MUST be able to create, edit, and deactivate products, categories, variants..." but only a create scenario exists — no edit/delete/deactivate scenario. Also: no `isActive`/archived field on `Category` (same known gap as `Product`), so "deactivate" isn't schema-supported for categories either.

**5. Test patterns confirmed**: `category.service.test.ts` (real Postgres, `randomUUID()` suffixes, `afterAll` cleanup), `route.test.ts` (`vi.mock("@/lib/auth", () => makeAuthMockModule())` + real Postgres, explicit status/body assertions per branch), `NewCategoryForm.test.tsx` (RTL + user-event, fetch stubbed), `e2e/admin-console.spec.ts` (Playwright, `loginAsAdmin(page)`, existing `"Admin categorias — create a category"` describe block is the natural place to extend).

**New finding — no REST-verb precedent.** Grepped `src/app/api/**` for `PATCH|PUT|DELETE`: zero route-handler hits. Every existing admin mutation, including the pure status-transition `src/app/api/admin/orders/[orderId]/pickup/route.ts`, uses `POST` exclusively. Introducing `PATCH`/`DELETE` route handlers for categories would be a first in this codebase — genuine fork for the proposal, not mechanical.

## Affected Areas

- `src/modules/catalog/category.service.ts` — add update/delete functions, a `P2003`-catching error class, possibly `getCategoryById`.
- `src/app/api/admin/categories/route.ts` or new `src/app/api/admin/categories/[id]/route.ts` (doesn't exist today).
- `src/app/admin/(console)/categorias/page.tsx` — needs an actions column.
- `src/app/admin/(console)/categorias/NewCategoryForm.tsx` — reused/generalized or a new sibling edit form.
- `prisma/schema.prisma` — untouched unless a reassignment path is chosen.
- `openspec/specs/admin-console/spec.md` — MODIFIED delta for edit/delete scenarios.

## Approaches

1. **Block delete on has-products (P2003 catch), slug immutable, all-POST routes** — Pros: zero new schema, reuses P2002-catch precedent exactly, no redirect gap, invariant untouched. Cons: owner can hit a dead end deleting a populated category (no reassign path exists anywhere yet); slug typos are permanent once products exist. Effort: Low.
2. **Block delete on has-products, but allow slug edit** — Pros: fixable typos. Cons: reopens the 404-on-bookmarked-URL gap knowingly. Effort: Low-Medium.
3. **Reassignment-capable delete + nullable categoryId or seeded fallback category** — Pros: no dead end. Cons: changes the "every product belongs to exactly one category" invariant, new picker UI, materially larger scope. Effort: High.

## Recommendation

Approach 1 is the lowest-risk fit for a scoped edit+delete slice: no schema change, reuses established error-handling shape, introduces no new gap. The owner-stuck-on-populated-category edge case is inherent to the current data model (no reassign flow exists today) and should be called out as a known limitation/follow-up rather than solved inline. Route-verb convention (all-POST vs. real PATCH/DELETE) has no forcing precedent and must be an explicit proposal decision.

## Risks

- No REST-verb precedent anywhere in the codebase — proposal must pick a convention explicitly.
- Slug editability is unresolved and has a genuine breaking-URL consequence if allowed without a redirect story (none exists).
- Deleting a populated category is a dead end today — no bulk-reassignment flow exists.
- "Deactivate" appears in spec prose for categories/products but has no schema backing — scope-creep risk if assumed in scope.
- No `getCategoryById` exists yet (only `getCategoryBySlug`) — small but real gap for an edit-by-id flow.

## Ready for Proposal

Yes — with three explicit decisions required before design: (1) slug editable or immutable post-creation, (2) delete-blocked-only vs. reassignment-capable delete, (3) all-POST vs. real PATCH/DELETE route verbs.
