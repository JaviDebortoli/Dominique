# Tasks: Admin Category Creation

> Strict TDD active. Every implementation task is preceded by its RED test (written first, failing) — shown as combined `RED→GREEN` lines, mirroring the archived `dominique-ecommerce` tasks.md convention. `RED→GREEN` means the test file is authored and run failing BEFORE the paired production code.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 650–900 (1 new lib pair, 1 service extension + its tests, 1 route + its tests, 2 new UI files + a component test, a 2-line comment drive-by, 1 E2E spec) |
| Session review budget | 800 lines (per preflight `review_budget_lines`, same convention as the archived change) |
| 800-line budget risk | Medium — borderline against the 800-line session budget; the bulk is hand-written integration/component tests mirroring already-shipped patterns (`product.service.test.ts`, `api/admin/products/route.test.ts`), which review faster per line than novel logic, but this is not "comfortably under" as a bare assumption |
| Chained PRs recommended | No — the six layers are sequentially dependent (slug util → service → route → UI → nav wiring → E2E); no mid-point produces an independently mergeable, functional slice |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk (default; not overridden in this launch) |
| Chain strategy | pending — not exercised; risk did not cross the High threshold that triggers the chain-strategy decision |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

**Risk note**: the estimate is a real computation (file-by-file line counts against this repo's own shipped analogues), not an assumption — see per-file basis below. It lands close to, not clearly under, the 800-line session budget. If the actual diff comes in above 800, `sdd-apply` should re-raise the chain-strategy question rather than proceed silently.

**Per-file basis**: `slugify.ts` ~30 / `slugify.test.ts` ~80 / `category.service.ts` additions ~60 / `category.service.test.ts` additions ~100 / `api/admin/categories/route.ts` ~80 / `route.test.ts` ~140 / `categorias/page.tsx` ~65 / `NewCategoryForm.tsx` ~120 / `NewCategoryForm.test.tsx` ~120 / `layout.tsx` +2 / `api/admin/products/route.ts` +1 (comment) / `e2e` spec ~35.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Full slice: slug util → service → route → UI → nav → E2E | PR 1 | `npm run test` (full Vitest suite) | `npx playwright test --workers=1 e2e/admin-console.spec.ts` (or a new `e2e/admin-categorias.spec.ts`) against a seeded local Postgres | Revert the PR: `src/lib/slugify.ts`, the `category.service.ts` additions, `api/admin/categories/`, `admin/(console)/categorias/`, and the nav link all disappear; already-created `Category` rows remain valid ordinary rows (proposal's Rollback Plan) |

## Phase 1: Slug Utility (Foundation)

- [x] 1.1 RED: write `src/lib/slugify.test.ts` — `toSlug`: `"Bijoutería"→"bijouteria"`, `"Ropa de Baño"→"ropa-de-bano"`, **explicit `ñ` case** (NFD-decomposes to `n` + combining tilde, not a single codepoint — must not survive as `ñ` or drop to nothing), `&`/punctuation → hyphen, collapsed/trimmed/no leading-trailing hyphens, idempotence (`toSlug(toSlug(x)) === toSlug(x)`); `isValidSlug` rejects uppercase, spaces, accents, leading/trailing/double hyphens, accepts `bijouteria`, `ropa-de-bano`.
- [x] 1.2 GREEN: implement `src/lib/slugify.ts` — `toSlug` (NFD-normalize, strip `\p{Diacritic}` **with the `u` regex flag** — without `u`, `\p{...}` is not a Unicode property escape and silently fails to match combining marks — lowercase, non-alphanumerics → single `-`, trim hyphens) + `isValidSlug` (`/^[a-z0-9]+(-[a-z0-9]+)*$/`).

## Phase 2: Category Service — Create + Admin List

- [x] 2.1 RED: extend `src/modules/catalog/category.service.test.ts` (mirrors `product.service.test.ts` conventions: real Postgres, `randomUUID()` suffixes, `afterAll` cleanup) — `createCategory` persists a row with the given `name`/`slug`; a duplicate `slug` throws `DuplicateCategorySlugError` **and writes nothing** (assert no new row via a follow-up count/find); `listAllCategoriesForAdmin` returns each category's `productCount` and is ordered by `name` asc.
- [x] 2.2 GREEN: add to `category.service.ts` — `DuplicateCategorySlugError` (`this.name = "DuplicateCategorySlugError"`, carries `slug`), `CreateCategoryInput`, `createCategory(prisma, input)` (catch Prisma `P2002` only — no pre-check `findUnique`, per design C2), `AdminCategoryRow`, `listAllCategoriesForAdmin(prisma)` (`_count: { select: { products: true } }`, `orderBy: { name: "asc" }`).

## Phase 3: `POST /api/admin/categories` Route

- [x] 3.1 RED: create `src/app/api/admin/categories/route.test.ts` (mirrors `api/admin/products/route.test.ts`: `vi.mock("@/lib/auth", () => makeAuthMockModule())`, real Postgres) — 401 when no session, writes nothing; 400 `invalid_request` for missing/empty `name` or `slug`; 400 `invalid_slug` for `"Ropa Interior"` and `"Bijoutería"` (spaces/accents rejected before any DB call — assert `prisma.category.create` never reached, e.g. via a Prisma spy or by asserting no row exists); 409 `duplicate_slug` with a readable `message`, no new row; **201 body is the full `createCategory` return value** (`NextResponse.json(category, { status: 201 })`, same pattern as `api/admin/products/route.ts`'s `NextResponse.json(product, { status: 201 })`) — assert it includes `id`, `name`, `slug`, `createdAt`, `updatedAt`, not a trimmed `{id,name,slug}` subset.
- [x] 3.2 GREEN: create `src/app/api/admin/categories/route.ts` — module doc referencing `src/proxy.ts` (not `middleware.ts`) per D7/C3, `auth()` 401 gate, `validateBody` (name/slug non-empty strings, trimmed), `isValidSlug(slug)` → 400 `invalid_slug` before calling the service, `createCategory(prisma, ...)`, catch `DuplicateCategorySlugError` → 409, rethrow anything else (500, same as products route).

## Phase 4: Admin UI — List Page + Create Form

- [x] 4.1 RED: create `src/app/admin/(console)/categorias/NewCategoryForm.test.tsx` (mirrors `CheckoutForm.test.tsx`: `@testing-library/react` + `user-event`, stubbed `fetch`) — slug field auto-fills from `name` via `toSlug` while untouched; stops auto-filling once the owner hand-edits slug (`slugTouched`); a stubbed 409 response renders its `message` inside `role="alert"`; a stubbed 201 clears `name`/`slug` state and triggers `router.refresh()` (mock `next/navigation`'s `useRouter`).
- [x] 4.2 GREEN: create `src/app/admin/(console)/categorias/NewCategoryForm.tsx` — controlled `name`/`slug`/`slugTouched` state, live `/categoria/{slug}` URL preview under the slug field, `fetch("/api/admin/categories", { method: "POST", ... })`, Editorial Minimalist tokens (`bg-nude` submit, `border-ink/20` inputs, `font-sans text-label-caps uppercase tracking-widest`, `text-red-700` + `role="alert"` for the server message).
- [x] 4.3 GREEN: create `src/app/admin/(console)/categorias/page.tsx` (RSC, mirrors `productos/page.tsx`) — `listAllCategoriesForAdmin(prisma)`, table `Categoría | Slug | Productos`, empty-state copy "Todavía no hay categorías. Creá la primera acá abajo.", renders `<NewCategoryForm />`.

## Phase 5: Nav Wiring + Drive-by Doc Fixes

- [x] 5.1 GREEN: `src/app/admin/(console)/layout.tsx` — add a `Categorías` `<Link href="/admin/categorias">` between `Productos` and `Pedidos`; fix the stale module-doc line 3 reference (`middleware.ts already blocks...`) to `src/proxy.ts` (comment-only, same file already touched for the nav link).
- [x] 5.2 GREEN: `src/app/api/admin/products/route.ts` — fix the stale module-doc line 6 reference (`NOT covered by src/middleware.ts's matcher`) to `src/proxy.ts` (comment-only, +0 behavior; prevents the wrong convention name propagating into the new route's own doc comment, which is copied from this file).

## Phase 6: End-to-End Verification

- [x] 6.1 RED→GREEN: add an "owner creates a category unaided" scenario to `e2e/admin-console.spec.ts` (or a new `e2e/admin-categorias.spec.ts` following the same `loginAsAdmin` helper pattern) — log in, go to `/admin/categorias`, submit a unique `name` (auto-suggested slug left as-is), assert it appears in the categories table with product count 0, then navigate to `/admin/productos/nuevo` and assert the same category now appears as an `<option>` in the category `<select>` — proves proposal Success Criteria #1/#2 end-to-end, the one cross-page path no unit/integration test alone covers.

## Open Items Carried Forward (from design.md)

- Category edit and delete remain out of scope (proposal, Open Decisions — RESOLVED). Ask the owner again after apply.
