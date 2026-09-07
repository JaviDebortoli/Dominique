```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:fe33a878f2d2374d7909cf50cf97b96ebc445d2be72dbae0f55fcc61347f0b09
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 3/3
scenarios: 12/12
test_command: vitest run
test_exit_code: 0
test_output_hash: sha256:fe33a878f2d2374d7909cf50cf97b96ebc445d2be72dbae0f55fcc61347f0b09
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: header-nav-admin-table-ux
**Version**: N/A (delta specs: storefront-browsing +1 requirement, admin-console +2 requirements)
**Mode**: Strict TDD
**Commit verified**: 1ca30a3 on feat/header-nav-admin-table-ux (worktree clean)

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 13 |
| Tasks complete | 13 |
| Tasks incomplete | 0 |

All 13 tasks marked [x] with evidence notes. The two production deltas (CategoryMenu aria-haspopup removal, Header narrow-tier flow layout) and all ratification tests are present in commit 1ca30a3 (27 files, +1545/-201).

### Build & Tests Execution

**Type-check**: PASSED - npx tsc --noEmit exit 0, no output.
**Lint**: PASSED - npx eslint . exit 0, no output.

**Tests (unit/integration)**: vitest run - 471 passed / 0 failed (57 files), exit 0, on a freshly restarted local prisma dev engine + npm run db:test:setup.

Documented flake: an earlier full run on a load-degraded engine failed exactly one test - src/modules/inventory/stock.service.test.ts "hold() concurrency" with Connection terminated unexpectedly (Prisma P1017 / DriverAdapterError ConnectionClosed). This is the KNOWN NON-BLOCKER documented verbatim in .env.test. Commit 1ca30a3 touches ZERO inventory/stock code (git show --stat confirms). After restarting the dominique-test prisma dev instance and reseeding, that test passes 21/21 in isolation and the full suite passes 471/471. Environmental only.

**E2E (Playwright chromium, serial --workers=1, fresh npm run db:test:setup)**:

| Spec | Result |
|------|--------|
| e2e/header-narrow-viewport.spec.ts | 1/1 PASS (3 runs) - scrollWidth==320, wordmark box y64-102 vs cluster box y110-130 (disjoint) |
| e2e/admin-narrow-viewport.spec.ts | 4/4 PASS (3 runs) - every wrapper overflow-x:auto, right==304 (<=320), scrollWidth>=clientWidth, th counts 6/8/4/6 (no column dropped) |
| e2e/admin-console.spec.ts | 5/5 PASS |
| e2e/storefront-browsing.spec.ts | 3/3 PASS in isolation on a fresh seed. Fails only when executed after e2e/admin-console.spec.ts in the same run: home-page test line 47 getByText("Vestido Roma") breaks because admin-console tests create products that evict "Vestido Roma" from listCuratedProducts(take:4). Pre-existing test-isolation issue (apply issue #3), not caused by this change. The header-nav delta assertions pass in every run. |

**Coverage**: Not collected (no coverage tool configured) - informational only.

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Header Category Navigation | Collapsed by default | CategoryMenu.test.tsx:17 + e2e storefront-browsing.spec.ts:19 (aria-expanded=false, nav count 0) | COMPLIANT |
| Header Category Navigation | Opening reveals category links | CategoryMenu.test.tsx:43 (links /categoria/vestidos + /categoria/accesorios, aria-expanded=true) | COMPLIANT |
| Header Category Navigation | Selecting a category closes + navigates | CategoryMenu.tsx:78 onClick setOpen(false) + CategoryMenu.test.tsx:49-60 href assertions; real navigation e2e storefront-browsing.spec.ts:38-42 (URL -> /categoria/vestidos) | COMPLIANT |
| Header Category Navigation | Escape / outside click dismiss (no navigation) | CategoryMenu.test.tsx:63 (Escape) + :75 (outside click) - links removed, no nav | COMPLIANT |
| Header Category Navigation | No categories means no control | CategoryMenu.test.tsx:92 (container empty); source guard CategoryMenu.tsx:44 | COMPLIANT |
| Header Category Navigation | Home-page category entry points unaffected | integration src/app/(store)/page.test.tsx:70-77 (dropdown link + tile link, >=2 links to category page) - passed in vitest run; e2e tile check storefront-browsing.spec.ts:50 | COMPLIANT |
| Product Table Exclusive Edit Mode | Only one edit form open at a time | ProductTableBody.test.tsx:52 (open A, open B -> single form, value A->B, "Vestido A" back to view); discard proven by reseed-from-props in ProductRow (ProductRow.test.tsx:129/143 no fetch) | COMPLIANT |
| Product Table Exclusive Edit Mode | Cancelling frees the table | ProductTableBody.test.tsx:115 (both "Editar" back after Cancelar) + ProductRow.test.tsx:129 (Escape) / :143 (Cancelar) restore view, no fetch | COMPLIANT |
| Product Table Exclusive Edit Mode | Saving closes the row | ProductTableBody.test.tsx:75 (form gone, refresh() once, both "Editar" back, second row still openable) | COMPLIANT |
| Product Table Exclusive Edit Mode | Expanded variant/image rows survive edit-mode changes | ProductRow.test.tsx:275 (VariantRow/AddVariantForm/ProductImages stay visible while editing core fields) | COMPLIANT |
| Admin Console Layout on Narrow Viewports | Wide table scrolls within its container | e2e/admin-narrow-viewport.spec.ts /admin/productos - wrapper overflow-x:auto, right 304<=320, scrollWidth 465>=clientWidth 288, th count 6 | COMPLIANT |
| Admin Console Layout on Narrow Viewports | Applies to every admin data table | e2e/admin-narrow-viewport.spec.ts /admin/caja (8 th), /admin/categorias (4 th), /admin/pedidos (6 th) - all contained, no dropped columns | COMPLIANT |

**Compliance summary**: 12/12 scenarios compliant.

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| Header Category Navigation | Implemented | CategoryMenu.tsx: collapsed disclosure button with aria-expanded, nav aria-label Categorias panel, one Link href /categoria/{slug} per category, Escape + outside pointerdown listeners removed on close/unmount, return null at zero categories. Header.tsx places it in the right-side cluster alongside the cart link. |
| Product Table Exclusive Edit Mode | Implemented | ProductTableBody.tsx: editingProductId FIFO-of-1; onExitEdit functional-updater stale-row guard. ProductRow controlled via isEditing/onEnterEdit/onExitEdit; drafts reseed from props on enter/cancel; expanded stays local and independent of edit state. |
| Admin Console Layout on Narrow Viewports | Implemented | overflow-x-auto div wraps the table in caja/page.tsx:58, pedidos/page.tsx:44, productos/page.tsx:63, categorias/page.tsx:23. No columns dropped. |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| Remove aria-haspopup from CategoryMenu trigger | Yes | grep confirms zero occurrences in CategoryMenu.tsx (only test assertions verifying absence). |
| Keep aria-expanded on trigger button | Yes | CategoryMenu.tsx:52. |
| Panel is nav aria-label Categorias | Yes | CategoryMenu.tsx:70-71. |
| Do not move focus on open | Yes | No focus call on open. |
| Focus on close - ratified with named follow-up | Yes (follow-up open) | Escape-from-inside drops focus to body; filed as follow-up, non-blocking. |
| Admin overflow via overflow-x-auto wrapper | Yes | All 4 tables. |
| Narrow-tier header: cluster in flow, absolute only at md: | Followed with documented deviation | Header.tsx:31 adds flex-wrap + gap-y-2 (removed at md: via md:flex-nowrap) beyond the literal justify-between remedy. Justified: pure justify-between keeps the boxes in flow without overlap but pushes scrollWidth past 320; wrapping the cluster to its own row is the minimal extension that satisfies both halves of the acceptance check. Now passes (scrollWidth==320, boxes disjoint). |

### Design Verification Hooks
| Hook | Result |
|------|--------|
| 320px header collision | PASS - e2e/header-narrow-viewport.spec.ts 1/1 - scrollWidth==320, wordmark/cluster boxes disjoint |
| ARIA attributes | PASS - aria-expanded toggles, no aria-haspopup, panel nav aria-label Categorias |
| Keyboard dismissal | PASS - CategoryMenu.test.tsx Escape + outside pointerdown; listeners cleaned up (useEffect cleanup, gated on open) |
| Admin overflow at 320px | PARTIAL - Table contract met (e2e/admin-narrow-viewport.spec.ts 4/4 - wrapper contained <=320, table scrolls inside wrapper, no column dropped). Residual page-level scrollWidth 327 (productos/categorias/pedidos) / 452 (caja) comes from NON-table filter/title rows, not the tables - outside the two delta specs scope. |
| Known non-blocker (real-Postgres integration flake) | Observed as documented - environmental; resolved by engine restart |

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | PASS | apply-progress.md TDD Cycle Evidence table present (tasks 1.1/1.2, 1.3, 1.4, 2.2, 3.3) |
| All tasks have tests | PASS | Code-delta tasks covered; Phase 2 = read-only ratification, Phase 3 = suite/browser/docs |
| RED confirmed (tests exist) | PASS | CategoryMenu.test.tsx (RED: aria-haspopup true received), ProductTableBody.test.tsx, e2e/header-narrow-viewport.spec.ts, e2e/admin-narrow-viewport.spec.ts all present |
| GREEN confirmed (tests pass) | PASS | Re-executed: CategoryMenu 7/7, Header 3/3, ProductTableBody 4/4, ProductRow 14/14; e2e header 1/1 + admin-narrow 4/4; full suite 471/471 |
| Triangulation adequate | PASS | CategoryMenu 2 ARIA states; ProductTableBody 3 assertions/save; admin-narrow data-driven over 4 tables |
| Safety Net for modified files | PASS | CategoryMenu.test.tsx 23/23 pre-change, ProductTableBody.test.tsx 3/3 pre-change |

**TDD Compliance**: 6/6 checks passed. Task 2.2 is a declared characterization/approval test (ProductRow.handleSave already called onExitEdit() on response.ok); it pins existing behavior and would fail if that call were removed - acceptable per Strict TDD for ratifying shipped code.

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit / Integration (jsdom) | 471 passing | 57 | vitest + @testing-library/react |
| E2E | 13 relevant | 4 | @playwright/test (chromium) |

### Assertion Quality
Scanned CategoryMenu.test.tsx, Header.test.tsx, ProductTableBody.test.tsx, ProductRow.test.tsx, e2e/header-narrow-viewport.spec.ts, e2e/admin-narrow-viewport.spec.ts, e2e/storefront-browsing.spec.ts.

- No tautologies, no ghost loops over possibly-empty collections, no smoke-only tests.
- CategoryMenu.test.tsx:95 toBeEmptyDOMElement() - legitimate negative case with companion positive render tests in the same file.
- e2e specs assert real layout geometry via a pure intersects() helper and measured bounding boxes.
- Minor: ProductTableBody.test.tsx:52 does not add an explicit expect(fetch).not.toHaveBeenCalled() for the "no save issued for product A" clause - covered indirectly by ProductRow.test.tsx:129/143. -> SUGGESTION.

**Assertion quality**: 0 CRITICAL, 0 WARNING (1 SUGGESTION).

### Quality Metrics
**Linter**: No errors (eslint . exit 0)
**Type Checker**: No errors (tsc --noEmit exit 0)

### Issues Found

**CRITICAL**: None.

**WARNING**:
1. Admin pages still have page-level horizontal overflow at 320px (document.documentElement.scrollWidth ~= 327 on productos/categorias/pedidos, ~= 452 on /admin/caja). Source is the NON-table filter/title rows (e.g. caja/page.tsx unconstrained search input + button + AutoRefresh in a non-wrapping flex), NOT the data tables - the overflow-x-auto wrappers are correctly contained (right edge 304 <= 320). Outside the scope of both delta specs (which require the tables to stay contained, and they do). Recommend a follow-up change to constrain the non-table rows.
2. e2e/storefront-browsing.spec.ts home-page test is fixture-coupled: it asserts a specific seeded product ("Vestido Roma") appears in listCuratedProducts(take:4), which sibling admin-console specs can evict when run in the same Playwright invocation. Pre-existing (apply issue #3), unrelated to the header-nav delta. Consider making the assertion resilient or reseeding per file.
3. Header.tsx narrow-tier remedy adds flex-wrap + gap-y-2 beyond design literal justify-between wording. Documented and justified (pure justify-between fails the scrollWidth==320 half of the acceptance check). Accepted deviation.
4. Local test-DB engine (prisma dev instance dominique-test, port 51222) drops connections (P1017 ConnectionClosed) under sustained concurrent load; it needed a restart mid-verification. A real ephemeral Postgres in CI would remove this recurring noise.

**SUGGESTION**:
1. Add an explicit expect(fetch).not.toHaveBeenCalled() to ProductTableBody.test.tsx:52 for the "no save issued when a row is evicted" clause.
2. Named design follow-up still open: CategoryMenu does not restore focus to the trigger when the panel unmounts while it holds document.activeElement (Escape-from-inside drops focus to body). Non-blocking.

### Verdict
**PASS WITH WARNINGS** - All 12 spec scenarios across both delta specs have runtime-passing test coverage; both production design deltas landed (aria-haspopup removed, aria-expanded retained, Header.tsx narrow-tier flow layout present); tsc and eslint clean; full vitest suite 471/471 green on a healthy engine; the two new 320px Playwright specs ran and pass (5/5); admin-console e2e 5/5; storefront-browsing e2e 3/3 in isolation. Non-green signals are all pre-existing or out-of-scope: a non-table page overflow at 320px on admin pages, an e2e fixture-ordering coupling, a documented/justified Header.tsx flex-wrap deviation, and local test-DB engine instability. 0 blockers. Recommend a follow-up change for the non-table admin page overflow.
