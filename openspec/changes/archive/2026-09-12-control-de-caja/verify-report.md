```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:c14210a5dbfc105a68d5cfba032075c52e5e85a3e4209ca247b576d317d95885
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 7/7
scenarios: 28/28
test_command: npx vitest run
test_exit_code: 0
test_output_hash: sha256:c14210a5dbfc105a68d5cfba032075c52e5e85a3e4209ca247b576d317d95885
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: control-de-caja
**Version**: N/A
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 34 |
| Tasks complete | 34 |
| Tasks incomplete | 0 |

### Build and Tests Execution
**Build**: PASSED
```text
npx tsc --noEmit
(no output, exit 0)
```

**Tests**: 559 passed / 0 failed / 0 skipped (67 test files)
```text
npx vitest run
Test Files  67 passed (67)
     Tests  559 passed (559)
  Duration  321.78s
```
Independently re-run twice by the verify phase (not trusted from apply-progress): both runs 559/559 passed, tsc clean both times.

**Coverage**: not available - no coverage tool configured (vitest run --coverage not wired into package.json scripts); skipped per graceful-handling rule, not a failure.

### Spec Compliance Matrix
| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| In-Person Sale Recording | Sale recorded with a payment method | sale.service.test.ts, stock/sell/route.test.ts:103 | COMPLIANT |
| In-Person Sale Recording | Sale rejected without a payment method | stock/sell/route.test.ts:116 | COMPLIANT |
| In-Person Sale Recording | Split payment is rejected | stock/sell/route.test.ts:131 | COMPLIANT |
| Sale Voiding (Anular) | Voiding restores exact stock and excludes from revenue | sale.service.test.ts (3.1), void/route.test.ts:78 | COMPLIANT |
| Sale Voiding (Anular) | Voiding an already-voided sale is rejected | sale.service.test.ts (3.2), void/route.test.ts:99 | COMPLIANT |
| Revenue Aggregation | Single-day filter | caja-report.service.test.ts | COMPLIANT |
| Revenue Aggregation | Date-range filter | caja-report.service.test.ts, report-day.test.ts:37 | COMPLIANT |
| Revenue Aggregation | No double-counting across Sale and Order | caja-report.service.test.ts:157 (3-line PAID order) | PARTIAL - see WARNING-1 |
| Revenue Aggregation | Voided sale excluded from totals | caja-report.service.test.ts:192 | COMPLIANT |
| Revenue Aggregation | Honest empty state for pre-ship-date ranges | caja-report.service.test.ts, reportes/page.test.tsx:62 | COMPLIANT |
| In-Person Sale Payment Method Choice | Staff selects a payment method before selling | CajaRowActions.test.tsx:39 | COMPLIANT |
| In-Person Sale Payment Method Choice | Submission blocked without a selection | CajaRowActions.test.tsx:27 | COMPLIANT |
| Sale Void Action Visibility | Anular available for an active sale | VoidSaleButton.test.tsx:27 | COMPLIANT |
| Sale Void Action Visibility | Anular unavailable for an already-voided sale | VoidSaleButton.test.tsx:33 | COMPLIANT |
| Revenue Report Page and Navigation | Report reachable from the nav | layout.tsx:22 (static check, no dedicated nav test) | PARTIAL - see WARNING-2 |
| Revenue Report Page and Navigation | Report offers both filter modes | reportes/page.tsx form; indirect coverage via page.test.tsx | PARTIAL - see WARNING-2 |
| Staff-Driven Status Transitions | MP order picked up unaffected | order.service.test.ts:824 | COMPLIANT |
| Staff-Driven Status Transitions | PICKUP_CASH pickup requires payment-method choice | order.service.test.ts:792, pickup/route.test.ts | COMPLIANT |
| Staff-Driven Status Transitions | Pickup blocked without selection | order.service.test.ts:792 | COMPLIANT |
| Staff-Driven Status Transitions | Selected method persists for reporting | order.service.test.ts:804 | COMPLIANT |
| Staff-Driven Status Transitions | Cancel PENDING_PAYMENT order | order.service.test.ts cancelOrder suite (pre-existing) | COMPLIANT |
| Staff-Driven Status Transitions | Cancel RESERVED order | order.service.test.ts cancelOrder suite (pre-existing) | COMPLIANT |
| Staff-Driven Status Transitions | Cancel blocked for PAID order | order.service.test.ts cancelOrder suite (pre-existing) | COMPLIANT |
| Staff-Driven Status Transitions | Cancel blocked for terminal-state order | order.service.test.ts cancelOrder suite (pre-existing) | COMPLIANT |
| Staff-Driven Status Transitions | Unauthenticated cancel request | orders/[orderId]/cancel/route.test.ts (pre-existing) | COMPLIANT |
| Staff-Driven Status Transitions | Cancel targets unknown order id | orders/[orderId]/cancel/route.test.ts (pre-existing) | COMPLIANT |
| Staff-Driven Status Transitions | Cancel affordance visibility | pedidos/page.test.tsx (pre-existing) | COMPLIANT |
| Staff-Driven Status Transitions | Customer lookup reflects cancellation (no new behavior) | pedido/[code]/page.test.tsx (pre-existing) | COMPLIANT |

**Compliance summary**: 25/28 scenarios fully COMPLIANT, 3/28 PARTIAL (weak-but-passing evidence, not failures) - see Issues.

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| voidSale() restock mechanism | Implemented | src/modules/sales/sale.service.ts:156 calls adjust() - the same conditional onHand+delta>=held AND onHand+delta>=0 UPDATE every other stock mutation in stock.service.ts uses. No blind onHand+=qty found. |
| Same-caja-day void window | Implemented | sale.service.ts:101-159 - atomic claim UPDATE sales SET voidedAt=... WHERE voidedAt IS NULL AND soldAt >= startOfArgentinaDay(now); 0-row reclassification distinguishes not-found/already-voided/window-closed. |
| Idempotent double-void | Implemented | Same atomic claim UPDATE is the entire guard; verified by route.test.ts:99 (409 on 2nd void) and service-level concurrent-double-void test (tasks 3.4). |
| distinct orderId on StockMovement(PAID) query | Implemented | caja-report.service.ts:133 - present exactly as apply-progress claimed, with inline comment explaining the 3-line-order risk it prevents. |
| markPickedUp() MP branch unaffected | Implemented | order.service.ts:520-526 - the PAID-branch code path never reads options at all; textually identical to pre-change behavior. options is only referenced inside the RESERVED branch. |
| Migration correctness | Implemented | migration.sql creates PaymentMethod enum, sales table (all 8 design columns), 2 indexes (soldAt, variantId), 3 FKs (variantId/actorId/voidedById), and one nullable orders.paymentMethod column - matches design.md D1/D3 exactly. Applied cleanly to the test DB by the verify phase itself (npm run db:test:setup, both migrations applied). |
| Historical-data honesty | Implemented | reportes/page.tsx:98-104 renders an explicit pre-ship-date message when report.limitedData is true, gated by CONTROL_DE_CAJA_SHIP_DATE = 2026-09-12 in caja-report.service.ts:106. Not a silent zero. |
| Git scope isolation | Implemented | git status shows only control-de-caja files as newly modified/created by this session. 5 unrelated files (AddVariantForm.tsx, AddVariantForm.test.tsx, ProductRow.tsx, variants/route.ts, variants/route.test.ts) are also modified, but their mtimes (2026-09-11 19:35-19:37) predate the control-de-caja session's first artifact (spec saved 23:39:57) by about 4 hours - these are the pre-existing, still-uncommitted SKU/stock session's own changes, untouched by control-de-caja's apply phase. |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 - flat Sale model | Yes | Exact shape matches migration.sql and schema. |
| D2 - nullable voidedAt as void marker | Yes | voidedAt IS NULL is both the report filter and the double-void guard, as designed. |
| D3 - nullable Order.paymentMethod, no backfill | Yes | Column added nullable; UNKNOWN bucket implemented for legacy rows exactly as documented. |
| D4 - StockMovement(PAID) as the revenue instant | Yes | caja-report.service.ts Q2 queries stockMovement with reason PAID. |
| D5 - fixed UTC-3 report day boundaries | Yes | report-day.ts implements Date.UTC(y,m,d,3,0,0); 21:30-ART-next-UTC-day case has a dedicated test. |
| D6 - inline progressive disclosure UI, not a modal | Yes | PaymentMethodChoice.tsx shared component consumed by both CajaRowActions and OrderPickupButton, matching the diagram. |
| Open Question 1 (void window = same caja day) | Resolved per user's stated confirmation | Implemented as same-caja-day; orchestrator input states this is owner-confirmed. |
| Open Question 2 (UNKNOWN bucket visibility) | Deviated, documented | Apply phase defaulted to "only when non-zero" and documented the default inline (reportes/page.tsx:58-61) since this question was left unconfirmed - acceptable per Hard Rules; does not break any spec requirement. |

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Yes | Full "TDD Cycle Evidence" table found in apply-progress (#104), one row per task group. |
| All tasks have tests | Yes | 34/34 tasks map to a listed test file; 2.6/5.7 explicitly marked as structural/no-branching, correctly exempted. |
| RED confirmed (tests exist) | Yes | All listed test files verified present on disk during this verification pass. |
| GREEN confirmed (tests pass) | Yes | 559/559 passed on independent re-run (twice) by this verify phase, not just trusted from apply-progress. |
| Triangulation adequate | Yes | Every task group lists 2+ distinct triangulating cases (CASH vs TRANSFER, voided vs not, 401/404/409x2/200) except 2.6 (correctly single-case/structural). |
| Safety Net for modified files | Yes | order.service.test.ts baseline reported as 41/44 to 44/44 after one legitimate pre-existing test update (RESERVED to PICKED_UP now requires paymentMethod), documented inline with a comment at order.service.test.ts:732-736 rather than silently changed. |

**TDD Compliance**: 6/6 checks passed

---

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | ~15 | report-day.test.ts, mergeRevenue() block in caja-report.service.test.ts | Vitest |
| Integration | ~35 | sale.service.test.ts, stock/sell/route.test.ts, sales void route.test.ts, order.service.test.ts, orders pickup route.test.ts, getRevenueReport() block, reportes/page.test.tsx | Vitest + real Postgres (project convention: no mocked Prisma) |
| Component | ~15 | CajaRowActions.test.tsx, VoidSaleButton.test.tsx, OrderPickupButton.test.tsx | Testing Library + userEvent |
| E2E | 1 (not executed) | e2e/admin-caja-reportes.spec.ts | Playwright - created, syntax-valid, collects cleanly; NOT run this session (see WARNING-3) |
| Total | 559 (vitest) + 1 uncollected e2e | 67 vitest files + 1 e2e file | |

---

### Changed File Coverage
Coverage analysis skipped - no coverage tool wired into this project's package.json (test script is plain "vitest run", no --coverage). Not treated as a failure per graceful-handling rule.

---

### Assertion Quality
| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| src/modules/reports/caja-report.service.test.ts | 188 | report.totals.MP.toNumber() modulo thisOrderTotal is asserted to be 0 | The modulo-based check does not actually distinguish "counted once" from "counted exactly 3 times" (a triple-count bug would produce 105000, which is still a multiple of 35000); the underlying code IS correct (verified separately via distinct orderId at caja-report.service.ts:133), but this specific assertion is weaker than its own comment claims. An exact equality assertion would be tight, since this describe block's afterAll cleans up and no other MP order exists in this test's time window. | WARNING |

**Assertion quality**: 0 CRITICAL, 1 WARNING (all other reviewed test files use real, distinct-value behavioral assertions; no tautologies, ghost loops, or ratio-mock issues found)

---

### Quality Metrics
**Linter**: Not run this session (not required by the phase's hard rules; tsc --noEmit, the project's actual gate, is clean)
**Type Checker**: PASSED - npx tsc --noEmit exit 0, no output, run twice independently

### Issues Found

**CRITICAL**: None

**WARNING**:
1. caja-report.service.test.ts:188 - the "no double-counting" 3-line-order test uses a modulo check that would not catch an exact-multiple over-count (e.g. 3x). Recommend tightening to an exact equality assertion against the known per-order total. The production code itself is correct (distinct orderId confirmed present and load-bearing at caja-report.service.ts:133) - this is a test-tightness gap, not a functional defect.
2. specs/admin-console "Revenue Report Page and Navigation" scenarios ("Report reachable from the nav", "Report offers both filter modes") have no dedicated component/integration test asserting the nav link renders or that both filter inputs are present and independently settable; coverage is indirect (via reportes/page.test.tsx's two searchParams cases and a static read of layout.tsx). Functionally present per source inspection, but not scenario-level test-proven the way the rest of the report requirement is.
3. e2e/admin-caja-reportes.spec.ts was NOT executed as a live browser run this session. This verify phase independently reproduced the exact blocker apply-progress reported: npx playwright test e2e/admin-caja-reportes.spec.ts fails immediately with "Another next dev server is already running" (PID 7956, port 3000, confirmed still listening via netstat), because Next.js's dev-server singleton lock is per-project-directory, not per-port, and blocks even the isolated port-3100 webServer this spec's playwright.config.ts tries to spawn. Killing PID 7956 was avoided (it is the live store's server plus ngrok tunnel for the real MercadoPago webhook path - out of scope and risky to touch during verification). The spec is syntax-valid and collects cleanly (--list: 1 test, 0 errors). The identical functional flow (sell with method -> appears in report -> void -> drops from report + stock restored) is proven end-to-end at the integration/component layer with real Postgres (sale.service.test.ts, sell/void route tests, caja-report.service.test.ts, reportes/page.test.tsx). Recommend running this one spec in CI or a maintenance window before the next real deploy, but this does not block a PASS-WITH-WARNINGS verdict given the equivalent real-DB coverage already in place.

**SUGGESTION**:
1. Consider wiring vitest run --coverage into CI so future verify passes have quantitative changed-file coverage instead of source-inspection-only evidence.
2. Consider adding a dedicated nav test asserting the /admin/reportes link renders, to close WARNING-2 without relying on manual source inspection.

### Verdict
PASS WITH WARNINGS

All 34/34 tasks complete and verified in code; 559/559 tests pass on two independent re-runs; tsc --noEmit clean; migration applies cleanly to a fresh test DB; all seven scrutiny items from the orchestrator (void safety pattern, same-day window, idempotent double-void, distinct orderId dedup, markPickedUp() MP-branch non-regression, migration file correctness, historical-data honesty, and git scope isolation) were independently verified against actual source, not taken on the apply phase's word. Three WARNINGs - one test-tightness gap in an otherwise-correct double-counting test, thin scenario-level coverage for two nav/filter-UI scenarios, and one environmentally-blocked (not code-caused) E2E execution gap with full equivalent real-Postgres coverage - keep this from a clean PASS but do not represent functional defects or spec violations.
