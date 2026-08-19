# Verification Report: 2026-08-18-admin-productos-edicion

**Change**: 2026-08-18-admin-productos-edicion
**Mode**: Full spec-driven verification (proposal/specs/design/tasks all present)
**Verified against**: `feat/admin-productos-edicion-ui` (full combined diff of 4 stacked PRs vs `main`)
**Commits**: `8d948f3` (service) -> `d6162de` (routes) -> `842bb50` (VariantRow) -> `bbd57af`, `c077e75` (ProductRow + page.tsx + e2e)

## Completeness

19/19 tasks in `tasks.md` marked `[x]`, spanning 6 phases across 4 stacked PRs. Verified against actual code state, not just the checkbox claim -- every task's described artifact exists in the diff and matches its description.

| Phase | Tasks | Status |
|---|---|---|
| 1. Product Service | 1.1-1.8 | [x] confirmed -- `product.service.ts` has all 4 mutators + 10 typed errors |
| 2. Product Route | 2.1-2.2 | [x] confirmed -- `PATCH`/`DELETE /api/admin/products/[id]/route.ts` |
| 3. Variant Route | 3.1-3.2 | [x] confirmed -- `PATCH`/`DELETE .../variants/[variantId]/route.ts` |
| 4. VariantRow UI | 4.1-4.2 | [x] confirmed -- `VariantRow.tsx` + 9 tests |
| 5. ProductRow UI | 5.1-5.3 | [x] confirmed -- `ProductRow.tsx` + 10 tests, `page.tsx` wiring |
| 6. E2E | 6.1-6.2 | [x] confirmed -- `e2e/admin-productos-edicion.spec.ts`, 2 scenarios |

## Build / Test Command Evidence

| Command | Result | Notes |
|---|---|---|
| `npm test` (full suite, real Postgres) | **284/286 passed** (2 failed) | Both failures are in `stock.service.test.ts` and `order.service.test.ts` -- pre-existing concurrency tests, **files not touched by this change**. Reproduced consistently as `Connection terminated unexpectedly` against the local pglite dev proxy under parallel load; confirmed this is the same documented proxy-instability pattern already logged in this change's own `apply-progress` (Discovery #4) and in earlier verifications this session -- not a regression |
| `npx vitest run "product.service.test.ts"` | 26/26 passed | all new + existing service tests |
| `npx vitest run "api/admin/products/[id]/route.test.ts"` | passed | product route |
| `npx vitest run ".../variants/[variantId]/route.test.ts"` | passed | variant route |
| `npx vitest run "ProductRow.test.tsx"` | 10/10 passed | |
| `npx vitest run "VariantRow.test.tsx"` | 9/9 passed | |
| `npx playwright test e2e/admin-productos-edicion.spec.ts --workers=1` | **2/2 passed** (isolated re-run, twice) | First combined run (alongside `admin-console.spec.ts`, right after a manual dev-proxy restart) hit transient `Connection terminated unexpectedly` / stale-DOM read on both specs simultaneously -- reran in isolation immediately after and both scenarios passed cleanly twice in a row. Root cause: local pglite proxy fragility under concurrent client load, not the change's code (matches the documented pattern) |
| `npx eslint` scoped to this change's 12 files | **clean, 0 errors** | Repo-wide `eslint .` reports 2 pre-existing errors in `.claude/worktrees/agent-ae2803ea805ebaaf7/deploy/testing/fake-pg-dump.cjs` -- unrelated to this change, outside its file list |
| `npm run build` (type-check signal, no standalone `tsc` script) | **success** | Both new routes (`/api/admin/products/[id]`, `.../variants/[variantId]`) and `/admin/productos` appear correctly in the route manifest; TypeScript pass clean |

## Spec Compliance Matrix

All scenarios below are the ones this change adds or extends in `openspec/changes/2026-08-18-admin-productos-edicion/specs/admin-console/spec.md`. Each is traced to its actual covering test, not just narrative claims.

| # | Scenario | Test | Result |
|---|---|---|---|
| 1 | Unauthenticated product or variant mutation -> 401 | `route.test.ts` (both files) "returns 401 ... and mutates/deletes nothing" | PASS |
| 2 | Owner edits a product's core fields (name/price/categoryId) | `product.service.test.ts` "persists name/description/price/categoryId and leaves slug byte-identical"; `route.test.ts` 200 case; `ProductRow.test.tsx` "Guardar PATCHes..." | PASS |
| 3 | Product slug key in payload rejected, not silently ignored | `route.test.ts` "returns 400 slug_immutable when the body carries a slug key at all, and leaves the row untouched" | PASS |
| 4 | Owner deletes a clean product | `product.service.test.ts` "succeeds on a clean product and cascades its variants + images away"; route test 200 case | PASS |
| 5 | Product delete blocked by order/stock history (cause-specific) | `product.service.test.ts` "throws ProductHasHistoryError with exact counts..."; route test 409 `product_has_history` | PASS |
| 6 | Product delete blocked by remaining stock (distinct message) | `product.service.test.ts` "throws ProductHasStockError naming the SKU for a variant with onHand > 0 and no StockMovement row"; route test 409 `product_has_stock` | PASS |
| 7 | Owner edits a variant's SKU | `product.service.test.ts` "changes sku"; variant route test 200; `VariantRow.test.tsx` | PASS |
| 8 | Duplicate SKU rejected on variant edit | `product.service.test.ts` "rejects a duplicate sku with DuplicateSkuError"; route test 409 `duplicate_sku` | PASS |
| 9 | Variant size/color immutable after first sale, sku-only still succeeds | `product.service.test.ts` "rejects size/color with VariantAttributesImmutableError once an OrderItem exists, while sku-only still succeeds"; route test 409 `variant_attributes_immutable` | PASS |
| 10 | Owner deletes a clean variant | `product.service.test.ts` "succeeds on a clean non-last variant"; route test 200 | PASS |
| 11 | Variant delete blocked by order/stock history | `product.service.test.ts` "throws VariantHasHistoryError for a StockMovement row"; route test 409 `variant_has_history` | PASS |
| 12 | Variant delete blocked by remaining stock | `product.service.test.ts` "throws VariantHasStockError for onHand > 0"; route test 409 `variant_has_stock` | PASS |
| 13 | Variant delete blocked as last-variant-standing, directs to delete the product | `product.service.test.ts` "throws LastVariantError when one variant remains, even if that variant is clean"; route test 409 `last_variant` | PASS |
| 14 | PATCH/DELETE on non-existent product or variant -> 404 | route tests, both files, `product_not_found`/`variant_not_found` cases | PASS |
| 15 | E2E: owner corrects price + category, storefront reflects it, URL unchanged | `e2e/admin-productos-edicion.spec.ts` "owner corrects a mistyped price and a wrong category" | PASS (2/2 isolated reruns) |
| 16 | E2E: delete blocked by history shows message, removes nothing | `e2e/admin-productos-edicion.spec.ts` "deleting a product that has an order shows the history message and removes nothing" | PASS (2/2 isolated reruns) |

## Design Decision Verification (F1-F9)

The orchestrator flagged this as the highest-risk part of this change given the application-level (non-DB-backed) `onHand` check. Verified directly against the diff, not the apply-report's narrative:

| Decision | Verified as-specced? | Evidence |
|---|---|---|
| **Slug immutable** -- `slug` key anywhere in PATCH body -> 400, whole request rejected | Yes | `route.ts` line 84: `if ("slug" in rawBody)` -> 400 `slug_immutable`, checked before any other validation, so it can never partially apply |
| **Delete blocked by history (P2003)**, cause-specific message | Yes | `deleteProduct`/`deleteVariant` both attempt-then-catch `P2003`, count `OrderItem`+`StockMovement` only on the failed path, throw `ProductHasHistoryError`/`VariantHasHistoryError` with a message distinct from the stock message |
| **Delete blocked by `onHand > 0`** -- application-level, no DB constraint backing it | Yes, confirmed actually enforced | `deleteProduct` (line 383-386) and `deleteVariant` (line 424-426) both **pre-check** `onHand > 0` before ever calling `.delete()` -- this is not merely documented, it is a live `if` gate that throws before the DB call. Confirmed via passing tests `"throws ProductHasStockError naming the SKU for a variant with onHand > 0 and no StockMovement row"` and `"throws VariantHasStockError for onHand > 0"`, both of which construct a variant with `onHand > 0` and **zero** `StockMovement` rows -- the exact case where `RESTRICT` cannot fire, proving the pre-check (not the DB) is doing the work |
| **Last-variant-standing blocked** | Yes | `deleteVariant` checks `siblingCount === 1` (unconditional, checked *before* the stock check per F4) -> `LastVariantError`; test confirms it fires "even if that variant is clean" |
| **`size`/`color` immutable once a variant has order history** -> 409 | Yes | `updateVariant`: `if (input.size !== undefined \|\| input.color !== undefined)` -> counts `OrderItem` -> `VariantAttributesImmutableError` -> route maps to 409 `variant_attributes_immutable`; test confirms an `sku`-only PATCH on the same historied variant still succeeds |
| **`sku` duplicate-checked** -> 409 | Yes | `updateVariant` catches `P2002` on the write -> `DuplicateSkuError` -> route 409 `duplicate_sku` |
| **Price freely editable** (safe -- `OrderItem.unitPrice` is its own snapshot) | Yes | `UpdateProductInput.price` is writable with no history gate anywhere in `updateProduct`; confirmed `unitPrice` is written once at order-creation time (own column on `OrderItem`, not a live reference to `Product.price`) -- editing a product's price after the fact cannot retroactively change a past order's total |
| **`onHand`/`held` never exposed in any PATCH payload** | Yes | `UpdateProductInput`/`UpdateVariantInput` structurally have no such fields; product route has no onHand/held handling at all (nothing to smuggle into, since there's no key ever read for it); variant route explicitly rejects (`400 stock_not_editable`) if `onHand` or `held` appears in the body at all -- a stricter guarantee than silent omission. `ProductRow.tsx`/`VariantRow.tsx` render no such inputs |

## Full-Chain Diff (`main..feat/admin-productos-edicion-ui`)

```
13 files changed, 2979 insertions(+), 33 deletions(-)
```

Matches `tasks.md`'s File Changes table and the apply-progress record exactly, with one exception (see Drift below).

## Issues

### CRITICAL
None.

### WARNING

1. **Branch chain forked from a stale `main`, and will delete `docs/bugs.md` on merge.** The 4-branch chain forked from commit `5046ff4`. Current `main` has since advanced to `f9f1580` ("docs: agregar registro de bugs conocidos"), which *adds* `docs/bugs.md`. Because the feature chain never had that file, `git diff main..feat/admin-productos-edicion-ui --stat` reports it as a **deletion** -- confirmed by inspecting the diff directly, the file is fully removed in the diff, not edited. This is branch divergence, not a deliberate change by this slice -- none of the 5 commits in the chain touch `docs/bugs.md`. **Action needed before merge/PR: rebase the branch chain onto current `main` (or merge `main` in) so `docs/bugs.md` survives.** Left unresolved, merging this chain as-is would silently delete a real, current documentation file.
2. **Local pglite dev-proxy instability reconfirmed** (already documented in this change's own `apply-progress` and in prior verifications this session). Concurrent test-runner load against the local dev proxy on port 51218 produces `Connection terminated unexpectedly` / `P1017`-class failures across unrelated files. Every failure observed during this verification was resolved by re-running in isolation immediately after a proxy restart (`prisma dev stop "*"` -> clear `%LOCALAPPDATA%\prisma-dev-nodejs\Data\**\*.lock*` -> `npx prisma dev -P 51218 -d`). Not a code defect in this change; an environment characteristic future sessions should keep budgeting for.

### SUGGESTION

1. `VariantRow.tsx` (unmodified, from PR 3) still types `variant.priceOverride` as `Decimal \| null`, now mounted live for the first time via `ProductRow`'s disclosure. No code path currently ever sets `priceOverride` (repo-wide grep confirms), so this is inert today, but flagged (as the apply-progress record itself already flags) as a latent landmine for a future `priceOverride` feature -- carrying the suggestion forward into this independent verification rather than just trusting the self-report.

## Test Data Hygiene

Checked the live dev database directly (not the apply-progress's self-report) after running the test suites. Present beyond the 3 real seeded categories (Vestidos/Remeras/Accesorios) and 3 real seeded products (Vestido Roma/Remera Basica/Cinturon Cuero):

- **1 orphaned category**: `Categoria E2E {timestamp}` (e.g. `categoria-e2e-1787108604909`)
- **1 orphaned product**: `Producto E2E {timestamp}` (e.g. `producto-e2e-1787108600684`)

Both were created by re-running the **pre-existing** `e2e/admin-console.spec.ts` "create a category"/"create a product" tests (run during this verification to check for regressions in that unmodified spec) -- those tests are documented as non-self-cleaning by design, a pattern already flagged in this change's own `apply-progress` (Discovery #5c) and in earlier verifications this session. **Zero pollution** from `admin-productos-edicion.spec.ts` itself -- its own `afterAll` cleanup ran correctly across every repeated run during this verification (including two isolated reruns), confirming its self-cleaning fixtures work as designed. Not cleaning this up per instructions; reporting the count (2 rows total) for the orchestrator to decide.

## Verdict

**PASS WITH WARNINGS**

All 19/19 tasks complete and verified against actual code, not just checkboxes. All 16 traced spec scenarios pass with real runtime evidence (service integration tests, route integration tests, component tests, and 2 e2e scenarios against the real running app + real Postgres). All F1-F9 design decisions verified directly in the diff, including the highest-risk item (the `onHand > 0` application-level pre-check, confirmed as a real enforced `if` gate via a test that deliberately builds a state `RESTRICT` cannot see). Build and lint are clean for every file this change touches. The 2 unit-test failures and the one flaky e2e run are all reproducible, pre-existing, environment-level (local pglite proxy) issues unrelated to this change's code -- not new regressions. The one substantive drift item is the stale-base `docs/bugs.md` deletion, which needs a rebase before this chain merges to current `main`, plus 2 leftover test-pollution rows from an unrelated pre-existing spec run during this verification.
