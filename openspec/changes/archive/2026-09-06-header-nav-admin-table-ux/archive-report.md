# Archive Report: Header nav collapse + admin table UX

**Change**: header-nav-admin-table-ux
**Date Archived**: 2026-09-06
**Commit**: 1ca30a3 (`feat(storefront,admin): collapse header category nav and contain admin tables`)
**Branch**: feat/header-nav-admin-table-ux

## Executive Summary

This SDD cycle retrofitted specifications onto an already-implemented, working-tree refactor that fixes three presentation defects:
1. The storefront header was crowded by a static category row under the wordmark
2. The four admin data tables (`productos`, `caja`, `categorias`, `pedidos`) overflowed the layout on narrow viewports instead of scrolling
3. Multiple product edit forms could be open at once, creating ambiguity about which "Guardar" applies where

All three changes are pure presentational UX improvements with no business logic or data-model impact. The cycle is now complete with all specifications merged into the main spec documents and the change archived.

## Final Verdict

**PASS WITH WARNINGS** — 0 blockers, 0 critical findings.
- All 13 implementation tasks are complete ([x] marked in tasks.md)
- All 12 specification scenarios across both delta specs have runtime test coverage
- Both production design deltas landed (aria-haspopup removed from CategoryMenu, aria-expanded retained; Header.tsx narrow-tier flow layout present)
- Static checks: `tsc --noEmit` clean, `eslint .` clean
- Unit/Integration tests: vitest run 471/471 passed on a healthy engine
- New E2E specs: 5/5 passed (`e2e/header-narrow-viewport.spec.ts` 1/1, `e2e/admin-narrow-viewport.spec.ts` 4/4)
- Existing E2E specs: storefront-browsing 3/3 in isolation, admin-console 5/5

## Task Completion

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1: Code deltas (TDD) | 1.1–1.4 | 4/4 complete ✓ |
| Phase 2: Spec ratification | 2.1–2.3 | 3/3 complete ✓ |
| Phase 3: Full-suite + browser + docs | 3.1–3.6 | 6/6 complete ✓ |
| **Total** | **13** | **13/13 complete ✓** |

All tasks marked `[x]` with evidence notes. See `openspec/changes/archive/2026-09-06-header-nav-admin-table-ux/tasks.md` for full ratification details.

## Specifications Merged

### storefront-browsing

**Merged requirement**: Header Category Navigation (ADDED, 6 scenarios)

The storefront header now presents category navigation as a single collapsed control (closed by default). When opened, it reveals one link per category to `/categoria/{slug}`. It closes on Escape, outside pointer interaction, or selecting a link. With zero categories, no control renders. The home-page category tiles remain unchanged.

**Coverage**: 6/6 scenarios compliant
- Collapsed by default: CategoryMenu.test.tsx:17 + e2e storefront-browsing.spec.ts:19
- Opening reveals links: CategoryMenu.test.tsx:43
- Selecting navigates + closes: CategoryMenu.test.tsx:49-60; e2e storefront-browsing.spec.ts:38-42
- Escape/outside dismiss: CategoryMenu.test.tsx:63, :75
- No categories = no control: CategoryMenu.test.tsx:92
- Home tiles unaffected: e2e storefront-browsing.spec.ts:50

### admin-console

**Merged requirements**:
1. **Product Table Exclusive Edit Mode** (ADDED, 4 scenarios) — At most one product row's inline edit form open at a time. Opening another row's form closes the first, discarding unsaved changes without saving. Closing (via cancel, Escape, or successful save) returns the row to view mode and frees every other row to edit.
2. **Admin Console Layout on Narrow Viewports** (ADDED, 2 scenarios) — Each admin data table remains within page width on narrow viewports, scrolling within its own container. No columns are hidden or dropped.

**Coverage**: 6/6 scenarios compliant
- Only one edit form open: ProductTableBody.test.tsx:52
- Cancelling frees table: ProductTableBody.test.tsx:115; ProductRow.test.tsx:129 (Escape), :143 (Cancelar)
- Saving closes row: ProductTableBody.test.tsx:75
- Expanded variant/image rows survive edit: ProductRow.test.tsx:275
- Wide table scrolls in container: e2e/admin-narrow-viewport.spec.ts /admin/productos
- Applies to every admin table: e2e/admin-narrow-viewport.spec.ts /admin/caja, /admin/categorias, /admin/pedidos

**Spec merge policy**: Both deltas add requirements only (no destructive merges). Per openspec/config.yaml, "Warn before merging destructive deltas" rule applies only to MODIFIED/REMOVED requirements. All additions are appended to their respective capability sections. No requirements were removed, renamed, or modified. ✓

## Key Artifacts

- **Archived folder**: `openspec/changes/archive/2026-09-06-header-nav-admin-table-ux/`
  - proposal.md ✓
  - design.md ✓
  - exploration.md ✓
  - specs/storefront-browsing/spec.md (delta) ✓
  - specs/admin-console/spec.md (delta) ✓
  - tasks.md (13/13 complete) ✓
  - apply-progress.md ✓
  - verify-report.md ✓

- **Main specs updated**:
  - `openspec/specs/storefront-browsing/spec.md` — added Header Category Navigation requirement + 6 scenarios
  - `openspec/specs/admin-console/spec.md` — added Product Table Exclusive Edit Mode + Admin Console Layout on Narrow Viewports requirements + 6 scenarios

## Verification Evidence Summary

### Static Checks
- `tsc --noEmit`: exit 0, no errors ✓
- `eslint .`: exit 0, no errors ✓

### Unit & Integration Tests
- vitest run: 471/471 passed on a healthy `prisma dev` instance ✓
- Known non-blocker: one earlier run saw a Prisma P1017 (ConnectionClosed) flake in stock.service.test — environmental, unrelated to this change, resolved by engine restart ✓

### E2E Tests (Playwright, chromium, --workers=1, fresh DB seed)
| Spec | Result | Details |
|------|--------|---------|
| e2e/header-narrow-viewport.spec.ts | 1/1 PASS ✓ | 320px header: scrollWidth===320, wordmark (y64–102) and cluster (y110–130) disjoint |
| e2e/admin-narrow-viewport.spec.ts | 4/4 PASS ✓ | Every table: wrapper overflow-x:auto, right edge ≤320, scrollWidth≥clientWidth, columns intact |
| e2e/storefront-browsing.spec.ts | 3/3 PASS ✓ | In isolation on fresh seed. Fixture-coupled when run after admin-console (pre-existing) |
| e2e/admin-console.spec.ts | 5/5 PASS ✓ | Product CRUD + edit mode tests |

### TDD Compliance
- RED confirmed: aria-haspopup=true initially present (CategoryMenu.test.tsx), overlap detected (e2e/header-narrow-viewport.spec.ts)
- GREEN confirmed after fix: aria-haspopup removed, Header.tsx flow layout applied
- All 12 spec scenarios have passing test coverage
- Safety net: 23 pre-change tests in CategoryMenu.test.tsx, 3 pre-change in ProductTableBody.test.tsx

## Warnings (Out of Scope, Pre-Existing, or Documented)

### Warning 1: Non-Table Page Overflow at 320px (Out of Scope)
**Status**: Observed, pre-existing, out of scope
**Finding**: Admin pages (`/admin/productos`, `/admin/caja`, `/admin/categorias`, `/admin/pedidos`) still have horizontal page overflow at 320px (document.documentElement.scrollWidth ~327 on productos/categorias/pedidos, ~452 on caja).
**Cause**: NOT the data tables — the `overflow-x-auto` table wrappers are correctly contained (right edge ≤320). The overflow comes from NON-table rows (filter/search inputs, buttons, AutoRefresh components in unconstrained flex layouts without wrapping).
**Spec Compliance**: The two delta specs require each table to "remain within page width on narrow viewports"; the table requirement IS met — each table wraps correctly inside its container and does not force page overflow. The residual page overflow is a separate layout issue with the filter/header rows, outside both delta specs' scope.
**Recommendation**: File a follow-up change to constrain the non-table header/filter rows on admin pages (e.g. make search inputs, buttons, and AutoRefresh responsive or wrappable at 320px).

### Warning 2: E2E Test Fixture Coupling (Pre-Existing)
**Status**: Pre-existing, unrelated to this change
**Finding**: `e2e/storefront-browsing.spec.ts` home-page test fails when run after `e2e/admin-console.spec.ts` in the same Playwright invocation because admin-console tests seed products that evict "Vestido Roma" from `listCuratedProducts(take:4)`.
**Scope**: Applies issue #3 from apply-progress.md; unrelated to header-nav or admin-table changes.
**Recommendation**: Make the home-page test resilient (e.g. assert a count of visible products rather than a specific product name) or reseed per test file to isolate fixtures.

### Warning 3: Header.tsx Narrow-Tier Flow Layout Deviation (Documented)
**Status**: Documented in design.md and verify-report.md, justified by acceptance check requirements
**Finding**: Header.tsx narrow-tier (below md: breakpoint) uses `flex-wrap` + `gap-y-2` rather than the design document's literal `justify-between` remedy.
**Justification**: Pure `justify-between` keeps the wordmark and cluster in flow without overlap (as required) but produces scrollWidth > 320 due to the box widths (~376px combined > 288px content width). Wrapping the cluster to its own row is the minimal extension that satisfies BOTH halves of the acceptance check: disjoint boxes AND scrollWidth===320.
**Impact**: Non-breaking enhancement; acceptance check passes (3 runs). Documented in design.md as the resolved strategy.

### Non-Blocker: Local Test Database Instability
**Status**: Environmental, not a product defect
**Finding**: The local `prisma dev` instance (dominique-test) occasionally drops connections (Prisma P1017 / DriverAdapterError ConnectionClosed) under sustained concurrent load.
**Resolution**: Resolved by restarting the test engine and reseeding the DB. Full suite passes 471/471 after restart.
**Impact**: Zero impact on this change (touches zero inventory/stock code). A real ephemeral Postgres in CI would eliminate this noise.

## Change Characteristics

| Attribute | Value |
|-----------|-------|
| Scope | Presentation only; no business logic, data model, or API changes |
| New components | 2: CategoryMenu.tsx, ProductTableBody.tsx |
| Modified components | 5: Header.tsx, ProductRow.tsx, productos/page.tsx, caja/page.tsx, categorias/page.tsx, pedidos/page.tsx, admin layout.tsx (button styling) |
| Lines changed | ~1545 additions, ~201 deletions (27 files total) |
| Database schema | No changes |
| API changes | No changes |
| Rollback | Fully reversible: delete CategoryMenu.tsx + ProductTableBody.tsx, revert touched files |
| Dependencies | No new packages |
| Design deviations | 1 documented (Header.tsx flex-wrap, justified by acceptance check) |

## Runtime Ledger Note

The owner explicitly accepted the commit's raw line count (1310 effective = ~800 SDD artifacts + ~240 pre-existing retrofit + ~90 authored apply lines) via an `sdd-attempt reset` request (ID: `reset-hnatux-budget-001`, actor: fernandaauat255@gmail.com). The verify attempt settled as `complete`. This archive closes the runtime ledger for this change.

## Follow-Up Recommendations

The following issues are recommended for separate changes (not blocking this archive):

1. **Admin Page Non-Table Overflow at 320px**
   - File: Recommend a new change to constrain filter/search/button rows on `/admin/caja`, `/admin/categorias`, `/admin/pedidos`
   - Severity: Low (affects owner-only console, low mobile priority)
   - Scope: Responsive design for non-table header rows, outside this cycle

2. **E2E Test Fixture Isolation**
   - File: Recommend resilient home-page test or per-file DB reseeding in `e2e/storefront-browsing.spec.ts`
   - Severity: Low (does not affect production)
   - Scope: Test infrastructure, outside this cycle

3. **Focus Return on Dropdown Close**
   - File: Recommend restoring keyboard focus to the CategoryMenu trigger when the panel unmounts (Escape-from-inside currently drops focus to body)
   - Severity: Very low (mouse and tab-through paths work; non-blocking per design.md)
   - Scope: Keyboard UX enhancement, candidate for a small follow-up PR

## Sources of Truth Updated

The following source-of-truth specs now reflect the new behavior:

- `openspec/specs/storefront-browsing/spec.md` — now includes Header Category Navigation requirement (6 scenarios) governing the new collapsed category menu
- `openspec/specs/admin-console/spec.md` — now includes:
  - Product Table Exclusive Edit Mode requirement (4 scenarios) governing exclusive edit form behavior
  - Admin Console Layout on Narrow Viewports requirement (2 scenarios) governing table containment on narrow viewports

Future changes that touch category navigation, product editing, or admin table layout MUST conform to these requirements.

## Archive Completion Checklist

- [x] All 13 implementation tasks marked complete in tasks.md
- [x] Both delta specs merged into main specs (non-destructive, additive-only)
- [x] Change folder moved to archive with date prefix (2026-09-06-header-nav-admin-table-ux)
- [x] Archived folder verified against pre-move snapshot (diff -r: empty = no truncation/alteration)
- [x] Main specs updated and reflect all merged requirements
- [x] Archive report written and covers final state per Final-State Authority hierarchy
- [x] Verify verdict confirmed: PASS WITH WARNINGS (0 blockers, 0 critical)
- [x] Three out-of-scope warnings documented and flagged as follow-up recommendations
- [x] Commit reference provided: 1ca30a3
- [x] Runtime ledger note recorded

## Cycle Status

**SDD Cycle Complete** ✓

This change has been fully planned (proposal), specified (delta specs merged into main specs), implemented, verified, and archived. All artifacts are now in the `openspec/changes/archive/2026-09-06-header-nav-admin-table-ux/` directory. The main specifications (`openspec/specs/storefront-browsing/spec.md` and `openspec/specs/admin-console/spec.md`) are the authoritative source of truth and reflect all new behavior.

Ready for the next change.
