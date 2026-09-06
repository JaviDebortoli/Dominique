# Tasks: Header nav collapse + admin table UX

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~240 already in tree + 5–20 for the two deltas (~245–260) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

Well under the 800-line review budget. One slice, one PR, no chaining, no `size:exception`.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Ratify shipped refactor + land the two design deltas | PR 1 | `vitest run src/components/storefront src/app/admin/(console)/productos` | `playwright test e2e/storefront-browsing.spec.ts e2e/admin-console.spec.ts` + manual 320px browser checks | Delete `CategoryMenu.tsx` + `ProductTableBody.tsx`, revert touched files |

## Phase 1: Code deltas (TDD)

- [x] 1.1 RED: in `src/components/storefront/CategoryMenu.test.tsx` add a case asserting the `/Categorías/` trigger `<button>` has `aria-expanded` (false closed, true open) and does **not** have `aria-haspopup`. Run `vitest run src/components/storefront/CategoryMenu.test.tsx` → fails. — DONE: RED confirmed (`aria-haspopup="true"` received).
- [x] 1.2 GREEN: remove `aria-haspopup="true"` from the trigger in `src/components/storefront/CategoryMenu.tsx:52`, keep `aria-expanded`. Re-run 1.1 + `Header.test.tsx` → green. — DONE: CategoryMenu 7/7 + Header 3/3 green.
- [x] 1.3 Run design's "Acceptance check": render `/` at 320×568 with ≥3 categories and `cartCount ≥ 10`; record whether the wordmark right edge intersects the cluster left edge and whether `document.documentElement.scrollWidth === 320`. — DONE (Playwright `e2e/header-narrow-viewport.spec.ts`): OVERLAP CONFIRMED before fix — wordmark box x16..272.8, cluster box x142.1..304.0 (intersect); `scrollWidth === 320` (no page overflow). Triggers 1.4.
- [x] 1.4 CONDITIONAL on 1.3: IF overlap or horizontal page scroll — RED first (Playwright or component assertion), then keep the header cluster in normal flow at the narrow tier in `src/components/storefront/Header.tsx` (`justify-between` default, `md:justify-center` + `md:absolute` cluster) → GREEN. IF 1.3 passes — record the measured result here and close with no code change. — DONE: overlap present, so code CHANGED. `Header.tsx` container now `flex-wrap justify-between gap-y-2 md:flex-nowrap md:justify-center`; cluster now in-flow below `md`, `md:absolute md:right-gutter md:top-1/2 md:-translate-y-1/2`. GREEN: wordmark box y64..102, cluster box y110..130 (no intersection), `scrollWidth === 320`. Deviation: added `flex-wrap` + `gap-y-2` beyond the literal `justify-between` remedy — pure `justify-between` would push the two ~226px + ~162px boxes past the 288px content width and cause horizontal page overflow; wrapping the cluster to its own row is the minimal way the sanctioned flow-layout remedy actually holds `scrollWidth === 320`.

## Phase 2: Spec ratification against the working tree (read-only, parallel-safe)

- [x] 2.1 `storefront-browsing` / **Header Category Navigation** (6 scenarios) — RATIFIED against the working tree:
  - Collapsed by default → `CategoryMenu.test.tsx:17` "starts closed, with the category links out of the accessibility tree"; trigger `aria-expanded=false` → `CategoryMenu.test.tsx:29` (new).
  - Opening reveals one link per category to `/categoria/{slug}`, control marked expanded → `CategoryMenu.test.tsx:44` "opens the category list on trigger click".
  - Escape dismiss, no navigation → `CategoryMenu.test.tsx:64` "closes on Escape".
  - Outside pointer dismiss → `CategoryMenu.test.tsx:76` "closes when clicking outside the menu".
  - No categories → no control → `CategoryMenu.test.tsx:93` "renders nothing when there are no categories"; `Header` path → `CategoryMenu.tsx:44` `if (categories.length === 0) return null`.
  - Dropdown alongside cart entry point → `Header.test.tsx:35` "exposes the category navigation via the top-right dropdown, alongside the cart entry point".
  - Home tiles unaffected + header dropdown → `src/app/(store)/page.test.tsx:56-78` (integration) and `e2e/storefront-browsing.spec.ts:10` (updated: opens dropdown, asserts 3 category links, clicks "Vestidos", asserts nav to `/categoria/vestidos` and collapse, plus the home tiles still link out).
  - "Selecting a category closes and navigates" → `CategoryMenu.tsx:79` `onClick={() => setOpen(false)}` + `href` assertions (`CategoryMenu.test.tsx:49-56`); real navigation covered by `e2e/storefront-browsing.spec.ts:10` (new assertion).
- [x] 2.2 `admin-console` / **Product Table Exclusive Edit Mode** (4 scenarios) — RATIFIED:
  - Only one edit form open at a time, other row's unsaved changes discarded, no save issued → `ProductTableBody.test.tsx:66` "closes the previously open row's edit form when a different row's Editar is clicked".
  - Cancelling / Escape frees the table → `ProductTableBody.test.tsx:113` "allows editing again after Cancelar closes the open row"; `ProductRow.test.tsx:129` (Escape) / `:143` (Cancelar) restore view without `fetch`.
  - Expanded variant/image sub-rows survive edit-mode changes → `ProductRow.test.tsx:275` "keeps the expanded VariantRow/AddVariantForm/ProductImages rows visible while editing".
  - "Saving closes the row" GAP → CLOSED with `ProductTableBody.test.tsx:75` (new) "returns the row to view mode and frees every row after a successful save" — asserts form gone, `refresh()` once, both "Editar" buttons back, another row still openable. Characterization test: passed on first run — `ProductRow.handleSave` already calls `onExitEdit()` on `response.ok`; the test now pins that behavior (would fail if `onExitEdit()` were dropped from the success path).
- [x] 2.3 `admin-console` / **Admin Console Layout on Narrow Viewports** (2 scenarios) — RATIFIED: `overflow-x-auto` wrapper confirmed present around `<table>` in all four — `caja/page.tsx:58`, `categorias/page.tsx` (`+`), `pedidos/page.tsx` (`+`), `productos/page.tsx` (`+`, wrapping `<thead>` + `<ProductTableBody>`). Behavioral proof → Phase 3.3 Playwright (`e2e/admin-narrow-viewport.spec.ts`), 4/4 pass.

## Phase 3: Full-suite + browser + docs

- [x] 3.1 Run `vitest run`, `eslint`, `tsc --noEmit`. — DONE:
  - `tsc --noEmit`: clean (exit 0).
  - `eslint .`: clean (exit 0).
  - `vitest run`: **470 passed / 1 failed** (471 total, 57 files). The single failure is `src/modules/inventory/stock.service.test.ts` "exactly one of several parallel hold() calls succeeds on the last unit" → `expected Error: Connection terminated unexpectedly ... to be an instance of OutOfStockError` (Prisma `P1017` / `DriverAdapterError: ConnectionClosed`). KNOWN NON-BLOCKER: the lightweight local `prisma dev` engine drops connections under the concurrent-PrismaClient load the integration suite creates — documented verbatim in `.env.test` ("it starts resetting connections (ECONNRESET / P1017 ConnectionClosed)"). Unrelated to this change (touches zero inventory/stock code). A less-parallel earlier run of the same suite failed 2 different `order.service` concurrency cases instead — same flaky class.
- [x] 3.2 Browser check — 320px storefront header collision (reuse 1.3 result). — DONE: see 1.3/1.4. Before fix: overlap. After `Header.tsx` fix: `e2e/header-narrow-viewport.spec.ts` passes (reproduced 3×), wordmark box and cluster box disjoint, `document.documentElement.scrollWidth === 320`.
- [x] 3.3 Browser checks — 320px admin tables ×4. — DONE via `e2e/admin-narrow-viewport.spec.ts` (seeds owner login per `e2e/admin-console.spec.ts` pattern), **4/4 pass** on a healthy DB. Per-table measured (viewport 320):
  - `/admin/productos`: wrapper `overflow-x: auto`, box right=304 (≤320), clientWidth 288, scrollWidth 465 (table scrolls inside wrapper), `<th>` count 6 — no column dropped.
  - `/admin/caja`: wrapper auto, right=304, clientWidth 288, scrollWidth 654, `<th>` 8.
  - `/admin/categorias`: wrapper auto, right=304, clientWidth 288, scrollWidth 355, `<th>` 4.
  - `/admin/pedidos`: wrapper auto, right=304, clientWidth 288, scrollWidth 288 (fits), `<th>` 6.
  - FINDING (out of scope, pre-existing): `document.documentElement.scrollWidth` is 327 on productos/categorias/pedidos and 452 on caja — i.e. the *page* still overflows horizontally at 320px. Source is NOT the table (wrapper right edge is 304): it is the non-table filter/title rows (`caja/page.tsx:36-56` unconstrained `<input type="search">` + button + `AutoRefresh` in a non-wrapping flex; similar `flex ... justify-between` header rows elsewhere) and admin layout chrome. The retrofit's `overflow-x-auto` correctly satisfies the spec's table requirement ("scroll horizontally within its own container rather than forcing the surrounding page layout to overflow" — the table no longer forces it); the residual page overflow is a separate pre-existing layout issue with no design remedy in this change. Recommend a follow-up.
- [x] 3.4 Run `playwright test e2e/storefront-browsing.spec.ts e2e/admin-console.spec.ts` (+ new specs). — DONE, run serially (`--workers=1`) on a freshly-reseeded test DB:
  - `e2e/storefront-browsing.spec.ts`: 3/3 pass (home-page test updated for the collapsed dropdown).
  - `e2e/admin-console.spec.ts`: 5/5 pass.
  - `e2e/header-narrow-viewport.spec.ts` (new): 1/1 pass.
  - `e2e/admin-narrow-viewport.spec.ts` (new): 4/4 pass.
  - Total 13/13 across isolated/small-batch serial runs. CAVEAT: running all four spec files together with Playwright's default 4 parallel workers is flaky — the local `prisma dev` engine floods `P1017 ConnectionClosed` under the concurrent `next dev` + direct-Prisma load, and sibling `admin-console` tests that create products also pollute the home page's `listCuratedProducts(take:4)` selection. Both are environment/fixture issues, not product defects; each spec passes cleanly in isolation on a fresh DB. `sdd-verify` should run these serially against a stable Postgres.
- [x] 3.5 `docs/bugs.md` reconciliation. — DONE: added three `~~…~~ **Resuelto** (2026-09-06, cambio `header-nav-admin-table-ux`)` entries under "Problemas ahora" for header crowding + ~320px wordmark/cluster overlap, admin table overflow on narrow viewports, and multiple product edit forms open at once; cross-linked the existing "producto expandido → Editar" entry (Resuelto 2026-08-25) both ways.
- [x] 3.6 Commit as one work unit per `work-unit-commits` SKILL. — DONE: branch `feat/header-nav-admin-table-ux` (off `feat/carrito-completo-hardening-e2e`), this commit (`git log -1` on `feat/header-nav-admin-table-ux`) `feat(storefront,admin): collapse header category nav and contain admin tables`, 27 files. Not pushed, no PR.
