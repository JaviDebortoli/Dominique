# Apply Progress: header-nav-admin-table-ux

**Change**: header-nav-admin-table-ux
**Mode**: Strict TDD (openspec `config.yaml` `rules.apply.tdd: true`, runner `vitest run`)
**Artifact store**: openspec
**Delivery**: single-pr, review budget 800 lines (forecast ~245–260, Low risk)
**Batch**: full (tasks 1.1 → 3.6), no prior apply-progress.

## Status

13 / 13 tasks complete. Ready for `sdd-verify`.

Headline results:
- **1.3**: the 320px header **DID overlap** before the fix (wordmark box `x 16..272.8`, cluster box `x 142.1..304.0` — intersecting; `scrollWidth` was already 320, so no page overflow, but the boxes collided).
- **1.4**: code **WAS changed** — `Header.tsx` moved the right-side cluster into normal flow below `md` (`flex-wrap` + `justify-between`, `md:` restores `justify-center` + absolute anchor). After the fix the boxes are disjoint (wordmark `y 64..102`, cluster `y 110..130`) and `scrollWidth === 320`.
- **vitest**: 470 passed / 1 failed (471). The 1 failure is a known-flaky real-Postgres concurrency test (`stock.service` P1017 `ConnectionClosed`), unrelated to this change.
- **eslint**: clean. **tsc --noEmit**: clean.
- **Playwright**: RAN (chromium installed, local `prisma dev` test DB brought up + seeded). All 13 relevant specs pass in isolated/serial runs; flaky only under full parallel execution because the lightweight local engine drops connections.

## Files changed

| File | Action | What |
|---|---|---|
| `src/components/storefront/CategoryMenu.tsx` | Modified | Removed `aria-haspopup="true"` from the trigger (task 1.2 / design "Resolved: CategoryMenu ARIA"). Retained `aria-expanded`. |
| `src/components/storefront/CategoryMenu.test.tsx` | Modified | RED test (task 1.1): trigger has `aria-expanded` toggling and **no** `aria-haspopup`. |
| `src/components/storefront/Header.tsx` | Modified | Task 1.4 flow-layout remedy: header row `flex-wrap items-center justify-between gap-y-2 md:flex-nowrap md:justify-center`; right cluster in normal flow below `md`, `md:absolute md:right-gutter md:top-1/2 md:-translate-y-1/2` at/above `md`. |
| `src/app/admin/(console)/productos/ProductTableBody.test.tsx` | Modified | Characterization test (task 2.2): a successful save returns the row to view mode and re-enables every row. |
| `e2e/header-narrow-viewport.spec.ts` | New | Task 1.3 acceptance check: `/` at 320×568, 3 seeded categories, cart cookie qty 12; asserts `scrollWidth === 320` and wordmark box ∩ cluster box = ∅. |
| `e2e/admin-narrow-viewport.spec.ts` | New | Task 3.3: the 4 admin tables at 320px — wrapper is `overflow-x-auto` within page width, wide tables scroll inside the wrapper, `<th>` count unchanged (no dropped columns). |
| `e2e/storefront-browsing.spec.ts` | Modified | Home-page test updated for the collapsed dropdown: open the "Categorías" control before asserting nav links; added click-to-navigate + collapse assertion. |
| `docs/bugs.md` | Modified | Task 3.5: three `Resuelto (2026-09-06)` entries + cross-link to the 2026-08-25 expanded-row entry. |

Working-tree retrofit files ratified read-only (not further modified beyond the above): `src/app/(store)/page.test.tsx`, `src/app/admin/(console)/{caja,categorias,pedidos}/page.tsx`, `src/app/admin/(console)/layout.tsx`, `src/app/admin/(console)/productos/{page.tsx,ProductRow.tsx,ProductImages.tsx,nuevo/NewProductForm.tsx}`, `src/app/admin/(console)/productos/ProductRow.test.tsx`, `src/components/storefront/Header.test.tsx`, and the new (uncommitted) `CategoryMenu.tsx` / `CategoryMenu.test.tsx` / `ProductTableBody.tsx` / `ProductTableBody.test.tsx`.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 / 1.2 | `src/components/storefront/CategoryMenu.test.tsx` | Integration (jsdom) | ✅ 23/23 pre-change (4 changed files) | ✅ Written — failed with `Received: aria-haspopup="true"` | ✅ Passed after removing the attr (CategoryMenu 7/7, Header 3/3) | ✅ 2 states asserted (closed → `aria-expanded=false` + no haspopup; open → `true` + no haspopup) | ➖ None needed (1-line attribute removal) |
| 1.3 | `e2e/header-narrow-viewport.spec.ts` | E2E (Playwright, chromium, 320×568) | N/A (new) | ✅ Written — failed: `wordmark {x16..272.8} overlaps cluster {x142.1..304.0}` | ✅ (see 1.4) | ✅ asserts both (a) `scrollWidth===320` and (b) box disjointness | ➖ n/a (measurement spec) |
| 1.4 | `e2e/header-narrow-viewport.spec.ts` | E2E | N/A | ✅ the 1.3 failure is the RED | ✅ Passed after `Header.tsx` flow-layout change — measured wordmark `y64..102`, cluster `y110..130`, `scrollWidth 320`; reproduced 3× | ➖ single scenario (one viewport) | ✅ cluster comment added; component tests still 9/9 |
| 2.2 | `src/app/admin/(console)/productos/ProductTableBody.test.tsx` | Integration (jsdom) | ✅ 3/3 pre-change | ➖ Characterization/approval test — passed on first run: `ProductRow.handleSave` already calls `onExitEdit()` on `response.ok`. Assertions fail if that call is removed (verified by inspection of `ProductRow.tsx:115`). | ✅ Passed (ProductTableBody 4/4) | ✅ 3 assertions: form removed, `refresh()` once, both "Editar" back, second row still openable | ➖ None needed |
| 3.3 | `e2e/admin-narrow-viewport.spec.ts` | E2E | N/A (new) | ✅ Written — first assertion set (`pageScrollWidth===320`) failed on all 4 pages, exposing the pre-existing non-table page overflow | ✅ Passed after refocusing assertions on the wrapper contract (`overflowX auto`, `right<=320`, `scrollWidth>=clientWidth`, `<th>` count) — 4/4 | ✅ 4 tables (data-driven), each with column-count + scroll-container checks | ➖ n/a |

## Test Summary

- Tests written/added: **3** (1 unit-level RED in `CategoryMenu.test.tsx`, 1 characterization in `ProductTableBody.test.tsx`, 2 new e2e specs with 5 test cases + 1 updated e2e case).
- Focused vitest (4 changed component files): CategoryMenu 7/7, Header 3/3, ProductTableBody 4/4, ProductRow 14/14 (unchanged) — all green.
- Full `vitest run`: 470 passed / **1 failed** (`stock.service` concurrency — env P1017, known non-blocker).
- Playwright: `header-narrow-viewport` 1/1, `admin-narrow-viewport` 4/4, `storefront-browsing` 3/3, `admin-console` 5/5 (serial / isolated, fresh DB).
- Layers used: Unit/Integration (jsdom) + E2E (Playwright chromium).
- Approval/characterization tests: 1 (task 2.2).
- Pure functions created: 0 (presentational React only; box-intersection helper in the e2e spec is pure).

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command + result | `npx vitest run src/components/storefront/CategoryMenu.test.tsx src/components/storefront/Header.test.tsx src/app/admin/(console)/productos/ProductTableBody.test.tsx src/app/admin/(console)/productos/ProductRow.test.tsx` → 28/28 pass. |
| Runtime harness command + result | `npx playwright test e2e/header-narrow-viewport.spec.ts e2e/admin-narrow-viewport.spec.ts e2e/storefront-browsing.spec.ts e2e/admin-console.spec.ts --workers=1` → 13/13 pass on a freshly-seeded local `prisma dev` test DB (`npm run db:test:setup`). Flaky under default parallel workers (local engine `P1017 ConnectionClosed`). |
| Rollback boundary | Revert `Header.tsx` + `CategoryMenu.tsx` + `CategoryMenu.test.tsx` + `ProductTableBody.test.tsx` + `e2e/storefront-browsing.spec.ts`; delete `e2e/header-narrow-viewport.spec.ts` + `e2e/admin-narrow-viewport.spec.ts`; revert `docs/bugs.md`. The pre-existing retrofit files (Header/table restructure, `overflow-x-auto` wrappers, `ProductTableBody.tsx`) are independent and were already in the tree. |

## Deviations from design

1. **Task 1.4 — `flex-wrap` added beyond the literal remedy.** design.md's "single sanctioned remedy" is `justify-between` default → `md:justify-center` + `md:absolute`. Applied as written, but *also* added `flex-wrap` + `gap-y-2` on the header row (removed at `md:` via `md:flex-nowrap`). Reason: the wordmark (~226px) and the cluster (~162px) together exceed the 288px content box at 320px; pure `justify-between` with no wrap keeps them in flow (no overlap) but pushes `document.documentElement.scrollWidth` past 320 (horizontal page scroll), which fails the acceptance check's second half. Wrapping the cluster onto its own row is the minimal extension that makes the sanctioned flow-layout approach satisfy *both* halves of the check. No wordmark shrink, no label drop (both explicitly rejected by design).

## Issues found (for sdd-verify)

1. **Pre-existing admin page horizontal overflow at 320px** (not caused by this change, no design remedy here): `document.documentElement.scrollWidth` = 327 on `/admin/productos`, `/admin/categorias`, `/admin/pedidos` and **452** on `/admin/caja`. The `overflow-x-auto` table wrappers are correctly contained (right edge 304 ≤ 320); the overflow comes from non-table rows — notably `caja/page.tsx`'s unconstrained `<input type="search">` + "Buscar" + `AutoRefresh` in a non-wrapping flex, and `flex justify-between` title/filter rows. Recommend a follow-up change to constrain those rows (`flex-wrap` / `min-w-0` / input `w-full`).
2. **Local `prisma dev` engine instability.** The lightweight local Postgres proxy used for tests (`.env.test`) resets connections (`P1017 ConnectionClosed` / "Connection terminated unexpectedly") under concurrent load — breaks the full parallel Playwright run and one vitest concurrency test. Needs `db:test:setup` reseed + serial execution, or a real Postgres, for a clean verify pass.
3. **`e2e/storefront-browsing.spec.ts` fixture coupling.** The home-page test asserts a seeded product ("Vestido Roma") appears in `listCuratedProducts(take: 4)`; sibling `admin-console` specs that create products can evict it. Passes on a fresh seed. Consider making the assertion resilient (assert the section renders ≥1 seeded product, or reseed per file).
4. **Named follow-up from design (unchanged, still open):** `CategoryMenu` does not restore focus to the trigger when the panel unmounts while it contains `document.activeElement` (Escape-from-inside drops focus to `<body>`). Non-blocking; design already filed it as a follow-up.

## Workload / PR boundary

- Mode: single PR (no chaining, no `size:exception`). Authored delta well under the 800-line budget: ~90 lines of new/changed test + spec code on top of the ~240-line retrofit already in the tree; only ~10 production lines changed by this phase (`CategoryMenu.tsx` −1, `Header.tsx` container/cluster classes).
- Boundary: starts from the uncommitted retrofit working tree; ends with one commit on `feat/header-nav-admin-table-ux` containing the retrofit + the two design deltas + tests + docs + openspec change folder.

## Commit

- Branch: `feat/header-nav-admin-table-ux` (created off `feat/carrito-completo-hardening-e2e` — that branch is 15 commits ahead of `main`, 0 behind, not merged, and the retrofit working tree sits on top of it; branching off `main` would drop those 15 commits).
- SHA: HEAD of branch `feat/header-nav-admin-table-ux` (this apply's single commit — `git log -1`).
- Not pushed. No PR opened.
