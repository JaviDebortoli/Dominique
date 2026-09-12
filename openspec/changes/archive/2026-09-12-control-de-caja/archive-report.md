# Archive Report: control-de-caja

**Date**: 2026-09-12  
**Change**: control-de-caja  
**Status**: ARCHIVED WITH WARNINGS  
**Verdict**: PASS_WITH_WARNINGS (per verify-report #106)

---

## Executive Summary

The `control-de-caja` change has been fully implemented, verified, and archived. All 34 tasks are complete; 559/559 tests pass; TypeScript is clean. Three non-critical warnings from verification remain as accepted limitations and do not block archive. No CRITICAL issues. Schema merged into main, specs updated in source of truth, change folder moved to archive.

---

## Artifact Observations (Traceability)

All observations retrieved and processed during archive phase:

| Artifact | Observation ID | Topic Key | Created | Type |
|----------|---|---|---|---|
| Exploration | #99 | sdd/control-de-caja/explore | 2026-09-11 23:14:39 | architecture |
| Proposal | #100 | sdd/control-de-caja/proposal | 2026-09-11 23:18:48 | architecture |
| Spec (Multi-Domain) | #101 | sdd/control-de-caja/spec | 2026-09-11 23:39:57 | architecture |
| Design | #102 | sdd/control-de-caja/design | 2026-09-11 23:43:27 | architecture |
| Tasks (34/34) | #103 | sdd/control-de-caja/tasks | 2026-09-11 23:49:36 | architecture |
| Apply Progress | #104 | sdd/control-de-caja/apply-progress | 2026-09-12 00:05:30 | architecture |
| Verify Report | #106 | sdd/control-de-caja/verify-report | 2026-09-12 00:50:20 | architecture |

---

## Final State (Source of Truth Authority)

Per the Final-State Authority hierarchy:

1. **Task Completion Gate**: All 34 implementation tasks marked `[x]` in `openspec/changes/archive/2026-09-12-control-de-caja/tasks.md` ✅
2. **Verification Result**: PASS_WITH_WARNINGS (obs #106), 0 CRITICAL, 3 WARNING
3. **Test Execution**: 559/559 tests passing (independent re-run verification, not self-reported)
4. **Build**: `npx tsc --noEmit` clean (verified twice independently)
5. **Schema Migration**: Applied cleanly to test DB (`npm run db:test:setup`)
6. **Working Tree State**: All changes uncommitted (per orchestrator instruction — no commits made during this session)

---

## Specifications Merged into Source of Truth

### New Capability

**`openspec/specs/sales-revenue/spec.md`** (created from delta)
- Records gross revenue from in-person sales with an explicit payment method
- Allows voiding a mistaken sale with exact stock restock
- Aggregates gross revenue split by payment method (`CASH`, `TRANSFER`, MercadoPago online)
- Filterable by single day or date range
- One `Sale` row per in-person variant sale, transactionally paired with existing `StockMovement(IN_STORE_SALE)` write

### Modified Capabilities

**`openspec/specs/admin-console/spec.md`** (3 new requirements added)
1. **In-Person Sale Payment Method Choice**: "Vender 1" action requires staff to select "Efectivo" or "Transferencia" before POST; UI blocks submission until one method is selected
2. **Sale Void Action Visibility**: "Anular" action available for active sales, hidden/disabled once voided
3. **Revenue Report Page and Navigation**: Nav link to new `/admin/reportes` page with single-day and date-range filter modes

**`openspec/specs/order-lifecycle/spec.md`** (Staff-Driven Status Transitions requirement modified)
- `PICKUP_CASH` pickups now require explicit payment-method selection (CASH or TRANSFER) at the "Marcar retirado" moment
- Selected method persists on the order for revenue reporting
- MercadoPago path (PAID orders) remains unaffected — no prompt, no new method field needed
- New scenarios document the payment-method capture and its absence for the MP path

---

## Verification Summary

**From verify-report obs #106:**

| Check | Result | Details |
|-------|--------|---------|
| Requirements Coverage | 7/7 compliant | All spec requirements covered; no missing requirements |
| Scenarios | 28/28 compliant | 25 COMPLIANT, 3 PARTIAL (weak-but-passing evidence, not failures) |
| Build | PASSED | `npx tsc --noEmit`, no output, exit 0 |
| Tests (Vitest) | PASSED | 559/559 passing, 67 test files, no failures (independently re-run twice) |
| Task Completion | 34/34 ✅ | All checkboxes marked `[x]` |
| Spec Compliance Matrix | PASS_WITH_WARNINGS | All core requirements implemented; 3 WARNINGs documented |

---

## Known Limitations (Accepted by Owner)

Per final-state facts and verify-report, three non-critical warnings remain as accepted follow-up work:

### WARNING-1: Modulo-Based Double-Count Test (Weak Assertion)
**File**: `src/modules/reports/caja-report.service.test.ts:188`  
**Issue**: The "no double-counting" test for 3-line PAID orders uses a modulo check (`report.totals.MP.toNumber() % thisOrderTotal === 0`) that would not catch an exact multiple over-count (e.g., 3x). The production code IS correct (verified by direct read of `distinct: ["orderId"]` at `caja-report.service.ts:133`), but this specific assertion is weaker than intended.  
**Decision**: Accepted as a test-tightness gap, not a functional defect. The underlying implementation is sound.

### WARNING-2: Thin Scenario-Level Nav/Filter UI Coverage
**Scenario**: "Revenue Report Page and Navigation" (`admin-console` specs: "Report reachable from the nav", "Report offers both filter modes")  
**Issue**: No dedicated component/integration test asserting the nav link renders or that both filter inputs are present and independently settable. Coverage is indirect via `reportes/page.test.tsx`'s two searchParams cases and a static source read of `layout.tsx`.  
**Decision**: Functionally present per source inspection. Recommend adding a dedicated nav test in follow-up to close without relying on manual inspection.

### WARNING-3: E2E Spec Not Executed (Environment Blocker)
**File**: `e2e/admin-caja-reportes.spec.ts`  
**Blocker**: `npx playwright test` for this spec failed with "Another next dev server is already running on port 3000" because Next.js's dev-server singleton lock is per-project-directory, not per-port. PID 7956 was left intentionally running (live store dev server + ngrok tunnel for real MercadoPago webhook path — out of scope to kill during verification).  
**Status**: Spec created, syntax-valid, collects cleanly (`npx playwright test --list: 1 test, 0 errors`). NOT executed as a live browser run this session.  
**Equivalent Coverage**: Identical functional flow (sell with method → appears in report → void → drops from report + stock restored) is proven end-to-end via real-Postgres integration tests in `sale.service.test.ts`, sell/void route tests, `caja-report.service.test.ts`, and `reportes/page.test.tsx`.  
**Recommendation**: Run this one spec in CI or a maintenance window before the next production deploy, or kill and restart the dev server in an isolated session.

---

## Files Moved to Archive

**Archived to**: `openspec/changes/archive/2026-09-12-control-de-caja/`

Archive contents (verified by diff-after-move):
```
archive-report.md                         ← This file (archive-report created post-move, not in snapshot)
design.md
exploration.md
proposal.md
specs/
  ├── admin-console/spec.md               (delta)
  ├── order-lifecycle/spec.md             (delta)
  └── sales-revenue/spec.md               (new — source spec)
state.yaml
tasks.md                                   (34/34 all marked [x])
verify-report.md
```

**Verification**: `diff -r` between pre-move snapshot and archived folder: EMPTY (no differences, byte-identity confirmed).

---

## Schema & Migration

**Prisma Migration**: `prisma/migrations/20260911235412_control_de_caja_sales_and_payment_method/`

Additive changes applied:
- `enum PaymentMethod { CASH TRANSFER }`
- `model Sale` with 8 columns (id, variantId, qty, unitPrice, paymentMethod, actorId, soldAt, voidedAt, voidedById) + 2 indexes (soldAt, variantId)
- `Order.paymentMethod PaymentMethod?` (nullable)
- Back-relations on `Variant` and `AdminUser` for sales tracking

Migration verified clean on test DB (`npm run db:test:setup`).

---

## Implementation Completion

**Delivery**: Single PR with owner-granted `size:exception` (locked 800-line budget, estimate ~1,700–1,950 lines).

**Work Units** (per suggested rollback boundaries in tasks.md):
1. ✅ Schema: PaymentMethod enum, Sale model, Order.paymentMethod, back-relations
2. ✅ In-person sale recording: sale.service.ts + route + PaymentMethodChoice UI + CajaRowActions
3. ✅ Sale voiding: voidSale() + void route + VoidSaleButton
4. ✅ PICKUP_CASH payment capture: markPickedUp() updated, OrderPickupButton with method prompt
5. ✅ Revenue report: report-day.ts (UTC−3 edges), caja-report.service.ts, reportes/page.tsx, nav link
6. ✅ E2E: admin-caja-reportes.spec.ts created, not executed (environment blocker documented)

**Deviations from Design** (minor, documented):
- `startOfArgentinaDay(now: Date)` added as a PRIVATE helper in sale.service.ts (not exported/shared with report-day.ts) — same UTC−3 idea, different input shape
- `RevenueReport` gained a `limitedData: boolean` field needed for the "Honest empty state for pre-ship-date ranges" spec requirement; gated by `CONTROL_DE_CAJA_SHIP_DATE = 2026-09-12`
- "UNKNOWN legacy bucket" visibility defaulted to "only when non-zero" in reportes/page.tsx (second Open Question was unconfirmed, defaulted per apply-progress)
- reportes/page.test.tsx added as a runtime-harness test beyond tasks.md 5.6, to satisfy mandatory Work Unit Evidence requirement

---

## TDD Compliance

- **All 34 tasks have explicit test evidence** in listed test files
- **RED-GREEN cycle confirmed** for all implementation tasks; 2 structural tasks (2.6, 5.7) correctly exempted as single-case/no-branching
- **Triangulation adequate** — every task group lists 2+ distinct cases (e.g., CASH vs TRANSFER, voided vs not, error codes)
- **Safety Net**: order.service.test.ts baseline (41/44) → (44/44 after legitimate update for new PICKUP_CASH requirement) documented inline

---

## Rolled-Back / Not-Included

Per scope confirmation:
- **Not in scope**: Earlier unrelated session work (SKU+stock variant feature in AddVariantForm.tsx, ProductRow.tsx, etc. with mtimes ~4 hours earlier than this session)
- **Not in scope**: MercadoPago CORS/sandbox fixes, next.config.ts changes — confirmed separate by mtime analysis
- **No commits made** in this session per orchestrator instruction

---

## Archive Readback (Mechanical Copy Verification)

**Readback Output**:
```
diff -r /tmp/snapshot/source openspec/changes/archive/2026-09-12-control-de-caja
```
**Result**: EMPTY (no output) — byte-identity verified, no truncation or alteration during move.

---

## SDD Cycle Completion

✅ Exploration (obs #99)  
✅ Proposal (obs #100, hand-edited by orchestrator post-save with scope expansions)  
✅ Specs (obs #101 + 3 delta specs in openspec/changes/)  
✅ Design (obs #102, Open Question on void window confirmed by orchestrator)  
✅ Tasks (obs #103, all 34 marked complete)  
✅ Apply (obs #104, all phases complete, TDD cycle documented)  
✅ Verify (obs #106, PASS_WITH_WARNINGS, no CRITICAL blockers)  
✅ **Archive** (this report)

---

**Change fully archived and closed. Ready for next change.**
