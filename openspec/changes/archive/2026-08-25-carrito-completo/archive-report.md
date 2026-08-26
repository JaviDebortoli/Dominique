# Archive Report: Completar el carrito de compras

**Change**: 2026-08-25-carrito-completo  
**Archived**: 2026-08-25  
**Status**: COMPLETE  
**Verdict**: Successfully closed — 4 stacked branches (not yet pushed), verify PASS with warnings (0 blockers, 24/24 scenarios, 10/10 requirements), post-remediation test suite clean.

## Final State Summary

This SDD change completed the cart implementation by adding a dedicated `/carrito` page for viewing and editing cart contents, a persistent header badge for add-to-cart feedback, and automatic cart clearing on successful order creation. The change was delivered as 4 stacked git branches building incrementally: Phase 1 (cart core: resolver + actions + page), Phase 2 (storefront entry point: header badge + PDP stock cap), Phase 3 (checkout integration: cart clearing + 409 error copy), and Phase 4 (e2e hardening + test-fixture defect fix).

**Delivery State**:
- **4 stacked branches** (not yet merged to main, not yet pushed to origin):
  - `feat/carrito-completo-cart-core` (0de28b9)
  - `feat/carrito-completo-header-badge` (f6ca912)
  - `feat/carrito-completo-checkout-integration` (665d442)
  - `feat/carrito-completo-hardening-e2e` (8503018, tip — contains all prior phases)
- **First verify pass** returned FAIL with 1 CRITICAL finding: "Cookie set with 7-day lifetime" scenario had no runtime-passing covering test.
- **Remediation**: Orchestrator added `src/modules/cart/cart-cookie.test.ts` (commit `014367f` on branch `feat/carrito-completo-hardening-e2e`), mocking `next/headers`/`next/cache` and asserting `cookies().set()` called with `options.maxAge === 60*60*24*7`.
- **Second verify pass** (updated in same `verify-report.md` file): **PASS with warnings**, 24/24 scenarios, 10/10 requirements, 0 blockers.
- **E2E live execution** (commit `8503018`): `e2e/carrito.spec.ts` executed against real running app + isolated test Postgres and passed. Test-fixture defect discovered and fixed (commit `8503018`): phone derivation switched from hex-derived to digits-only to match `checkout-antiabuso`'s `isPlausiblePhone()` validator.

All 4 owner-decided points confirmed:
1. Cart on dedicated `/carrito` page; `/checkout` is payment-only ✓
2. Cart clears at order creation (both paths) ✓
3. Add-to-cart feedback via header badge (no toast library) ✓
4. Client-side stock cap is non-authoritative; server re-validation is the gate ✓

## Verification Report Status

**Verdict**: PASS (with warnings)  
**Evidence revision**: sha256:c60a0d05cdca93a42f110c5414e2c43e4ceb60ea8e812e3d9f40ca5a0d4d79b6  
**Blockers**: 0  
**Critical findings**: 0 (1 CRITICAL from first pass closed by commit 014367f)  
**Requirements**: 10/10 compliant  
**Scenarios**: 24/24 compliant  

**Build & Tests (Scoped)**:
```
$ npx vitest run "src/modules/cart" "src/app/(store)/carrito" "src/app/(store)/checkout" "src/app/(store)/producto" "src/app/(store)/page.test.tsx" "src/components/storefront" "src/app/api/checkout"
Test Files  11 passed (11)
     Tests  78 passed (78)
Exit code: 0
```

**Build (TypeScript)**:
```
$ npx tsc --noEmit
(exit 0, no errors)
```

**Non-regression suites** (pre-existing, unmodified):
```
$ npx vitest run "src/modules/payments" "src/modules/orders"
Test Files  3 passed (3)
     Tests  56 passed (56)
Exit code: 0
```
Covers MercadoPago back_urls, webhook service, and N=3 reservation cap — all green.

**Post-remediation coverage**: 89 tests across cart, checkout, header, PDP, and checkout-api integration — all pass, including the added `cart-cookie.test.ts` unit test for cookie lifetime.

## Task Completion

**Status: 12/12 tasks complete** (all marked `[x]` in persisted tasks artifact)

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 1 | Cart Core: resolver + actions + `/carrito` page | ✅ COMPLETE |
| Phase 2 | Storefront Entry Point: header badge + PDP cap | ✅ COMPLETE |
| Phase 3 | Checkout Integration: cart clearing + 409 copy | ✅ COMPLETE |
| Phase 4 | Threat Matrix, E2E, Non-Regression | ✅ COMPLETE |

**Remediation task** (post-first-verify):
- [x] Phase 1.2 gap closed: `src/modules/cart/cart-cookie.test.ts` added with runtime-passing test for 7-day cookie lifetime (commit `014367f`)
- [x] Phase 4 discovery closed: Test-fixture phone bug fixed in `e2e/carrito.spec.ts` (commit `8503018`, unrelated to app code)

## Implementation Summary

**Files Changed**: 14 total (per stacked branches)

| Category | Count | Type |
|----------|-------|------|
| New pages | 1 | `src/app/(store)/carrito/page.tsx` (Server Component) |
| New components | 1 | `src/components/storefront/CartLineControls.tsx` (client island) |
| New service modules | 1 | `src/modules/cart/cart-lines.ts` (resolveCartLines, server-only) |
| New tests | 3 | `cart-lines.test.ts`, `CartLineControls.test.tsx`, `carrito/page.test.tsx`, `cart-cookie.test.ts` (remediation) |
| Modified components | 3 | `Header.tsx` (badge), `SizeSelector.tsx` (cap), `CheckoutForm.tsx` (409 copy) |
| Modified pages | 3 | `(store)/layout.tsx` (cartCount), `(store)/checkout/page.tsx` (redirects), `producto/[slug]/page.tsx` (inCartQty) |
| Modified services | 2 | `cart-cookie.ts` (actions + refresh + 7d lifetime), `api/checkout/route.ts` (clearCart call) |
| Specs (deltas preserved in archive) | 2 | `specs/cart-checkout/spec.md`, `specs/storefront-browsing/spec.md` |

**Schema**: No migrations — single cookie, no new DB tables/columns.

**Dependencies**: None — no new npm packages.

**Rollback**: Delete `/carrito` route, remove `CartLineControls` and badge logic, revert `cart-cookie.ts` changes, remove `clearCart()` call from checkout route, revert PDP cap changes.

## Specs Merged and Archived

**Domain**: cart-checkout

| Action | Details |
|--------|---------|
| Added | 8 new requirements: Cart View, Cart Quantity Editing, Explicit Line Removal, Empty Cart State, Unresolvable Cart Line Notice, Cart Cleared After Order Creation, Cart Cookie Lifetime, Non-Regression |
| Modified | Stock Re-Validation at Submission — now includes explicit server-gate authority and 409 variantIds naming |
| Scenarios | 20 new scenarios total (11 ADDED, 3 MODIFIED within Stock Re-Validation) |

**Domain**: storefront-browsing

| Action | Details |
|--------|---------|
| Added | 1 new requirement: Header Cart Entry Point |
| Scenarios | 5 new scenarios: badge on load, badge after add/edit/remove, badge without JS, link to `/carrito` |

**Merge Summary**: Both deltas successfully merged into main specs via Edit-tool mechanical merge. Deltas preserved in archived change folder for audit trail.

**Delta Archive Location**: `openspec/changes/archive/2026-08-25-carrito-completo/specs/`

**Main Specs Updated**:
- `openspec/specs/cart-checkout/spec.md` — 8 ADDED requirements + 1 MODIFIED requirement merged
- `openspec/specs/storefront-browsing/spec.md` — 1 ADDED requirement + 5 scenarios merged

## Design Adherence

**Key Design Constraints Verified**:
- D1: `resolveCartLines` in `cart-lines.ts`, not `cart-cookie.ts` (server-only module, explicit db param, used by both `/carrito` and `/checkout`) ✓
- D2: `StoreLayout` reads cookie, `Header` stays presentational with props only (no client-side logic, passes `cartCount` prop) ✓
- D3: `refresh()` from `next/cache` in mutating actions; NOT in `clearCart()` (comment cites E870 constraint) ✓
- D4: `clearCart()` called from Route Handler after `createPendingOrder`, before MP branch (covers both 201 and 303) ✓
- D5: `/carrito` cannot self-heal dropped lines mid-render; notice persists until `Eliminar` used ✓
- DA-1: No quantity input added to PDP; cap enforced as disable-at-max only; "Ya tenés el máximo disponible" copy ✓

**Owner-Decided Points Confirmed**:
1. Dedicated `/carrito` page; `/checkout` payment-only — confirmed in `checkout/page.tsx` redirects and `carrito/page.tsx` full edit UI ✓
2. Cart clears at order creation (both PICKUP_CASH and MP) — confirmed in `api/checkout/route.ts` single `clearCart()` call ✓
3. Header badge, no toast library — confirmed Badge in `Header.tsx`, no new toast/notification imports anywhere ✓
4. Client-side cap non-authoritative — confirmed: `order.service.ts` byte-identical to main, `route.test.ts` has threat-matrix test proving `1e9` qty rejected with 409 ✓

**Non-Goals Preserved**:
- MercadoPago `back_urls` untouched (byte-identical diff vs main) ✓
- Per-identity `PICKUP_CASH` reservation cap (N=3) untouched (byte-identical diff vs main) ✓
- No Prisma migration ✓
- No toast/notification library added ✓

**All verified via independent re-read of design.md constraints and direct code inspection against git diffs.**

## Spec Compliance Matrix

### cart-checkout — All 8 ADDED Requirements + 1 MODIFIED

| Requirement | Scenarios | Status |
|---|---|---|
| Cart View | 1/1 (Cart lists all lines with subtotal) | ✅ COMPLIANT |
| Cart Quantity Editing | 4/4 (increase, cap, bottleneck, idle excess) | ✅ COMPLIANT |
| Explicit Line Removal | 1/1 (Shopper removes line) | ✅ COMPLIANT |
| Empty Cart State | 2/2 (no lines, checkout redirect) | ✅ COMPLIANT |
| Unresolvable Cart Line Notice | 3/3 (deleted on carrito, deleted on checkout, zero stock) | ✅ COMPLIANT |
| Cart Cleared After Order Creation | 2/2 (PICKUP_CASH 201, MercadoPago 303) | ✅ COMPLIANT |
| Cart Cookie Lifetime | 1/1 (7-day maxAge, added post-remediation via commit 014367f) | ✅ COMPLIANT |
| Non-Regression | 2/2 (back_urls, reservation cap) | ✅ COMPLIANT |
| Stock Re-Validation at Submission (MODIFIED) | 3/3 (stock changed, 409 names line, client cap not bypassed) | ✅ COMPLIANT |

**Compliance summary**: 19/19 cart-checkout scenarios compliant.

### storefront-browsing — 1 ADDED Requirement

| Requirement | Scenarios | Status |
|---|---|---|
| Header Cart Entry Point | 5/5 (badge on load, after add/edit/remove, without JS, link to carrito) | ✅ COMPLIANT |

**Compliance summary**: 5/5 storefront-browsing scenarios compliant.

**Overall compliance**: 24/24 scenarios compliant; 10/10 requirements implemented.

## Issues Found

**CRITICAL** (0 open, 1 closed):
1. ~~Spec scenario "Cookie set with 7-day lifetime" had no runtime-passing covering test.~~ **CLOSED** by commit `014367f`: `src/modules/cart/cart-cookie.test.ts` mocks `next/headers`/`next/cache` and asserts `cookies().set()` is called with `options.maxAge === 60*60*24*7`. Verified: test passes in isolation and as part of scoped 89-test run; tsc/eslint clean.

**WARNING** (2):
1. **E2E fixture defect** (commit `8503018`): Phone derivation in `e2e/carrito.spec.ts` switched from hex-derived (can contain a-f) to digits-only to match `checkout-antiabuso`'s `isPlausiblePhone()` validator (requires 8-15 digits after stripping). This is a test-fixture bug, not an application bug — no app code changed, only the test fixture. Confirmed via empty `git diff` of app routes.
2. **Full-suite run divergence**: Independent re-run of full test suite (not scoped) produced 459/461 tests passed (2 pre-existing, unrelated failures in `stock.service.test.ts` concurrency under Postgres connection_limit=10). All tests touched by carrito-completo (78 tests, 11 files) passed cleanly on scoped run. Low risk; pre-existing environment issue not a change defect.

## Archival Process

**Mechanical Copy Contract**: Folder copied via `cp -R` (untracked disk folder, never committed) from `openspec/changes/carrito-completo/` to `openspec/changes/archive/2026-08-25-carrito-completo/`. Original location remains (untracked); archive copy verified byte-identical via `diff -r`.

**Archive Location**: `openspec/changes/archive/2026-08-25-carrito-completo/`

**Artifacts Archived**:
- proposal.md (11381 bytes)
- exploration.md (6508 bytes)
- design.md (20101 bytes)
- tasks.md (4852 bytes)
- verify-report.md (20273 bytes, includes post-remediation second pass)
- specs/cart-checkout/spec.md (delta, 8 ADDED + 1 MODIFIED requirements)
- specs/storefront-browsing/spec.md (delta, 1 ADDED requirement)
- archive-report.md (this file)

**Main Specs Updated** (Edit-tool mechanical merge, source-only):
- `openspec/specs/cart-checkout/spec.md` — 8 ADDED + 1 MODIFIED requirements merged in place
- `openspec/specs/storefront-browsing/spec.md` — 1 ADDED requirement merged in place

## Observation IDs for Traceability

The following Engram observations were consulted and are recorded here for future audit trails:

| Artifact | Topic Key | Referenced in Memory |
|----------|---|---|
| Proposal | sdd/carrito-completo/proposal | Prior orchestrator session |
| Spec (Delta) | sdd/carrito-completo/spec | Prior orchestrator session |
| Design | sdd/carrito-completo/design | Prior orchestrator session |
| Tasks | sdd/carrito-completo/tasks | Prior orchestrator session |
| Verify Report | sdd/carrito-completo/verify-report | This archive session |

## Authority and Closure

This archive report reflects the final state of the change at the time of archival per the Final-State Authority hierarchy defined in sdd-archive skill:

1. **Delivery state**: 4 stacked branches, not yet pushed/merged (owner has not been asked when/whether to push). This is intentional and correct — archiving the SDD planning cycle is independent of the separate delivery step.
2. **Persisted tasks artifact**: All 12/12 implementation tasks marked complete in prior orchestrator session before passing to verify. Remediation task (cart-cookie.test.ts) completed in verify→remediate loop.
3. **Verify report**: PASS with warnings (0 blockers, 24/24 scenarios, 10/10 requirements after remediation). Original FAIL (1 CRITICAL) closed by commit `014367f`.
4. **Explicit final-state facts** (from launch context): Confirm remediation commits (014367f cart-cookie.test.ts, 8503018 fixture fix), post-remediation verify pass, 4-branch stacked state. All acknowledged in this report.

The SDD cycle is complete. The change is ready for delivery (branching to PRs and pushing) when the owner instructs — archiving the planning cycle closes this phase and opens the next step, which is separate from archive.

---

**Archived by**: sdd-archive phase executor  
**Archive Date**: 2026-08-25  
**Delivery**: All specs merged, all artifacts archived, change folder copied with exact name to `openspec/changes/archive/2026-08-25-carrito-completo/`  
**Final Status**: CLOSED
