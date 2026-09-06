# Proposal: Header nav collapse + admin table UX

## Intent

Retrofit specs onto an already-implemented, uncommitted working-tree refactor
that fixes three small presentational defects at once: the storefront header is
crowded by a static category row under the wordmark; the four admin data tables
overflow the layout on narrow viewports instead of scrolling; and every
`ProductRow` owned its own edit state, so staff could open several edit forms at
once with no indication which "Guardar" applied where. None of the three touches
business logic. Static checks already pass (`tsc`, `eslint`, component tests).

## Scope

### In Scope

- New `CategoryMenu.tsx` client disclosure dropdown; `Header.tsx` recomposed to
  a centered wordmark with a right-side cluster (`CategoryMenu` + cart link)
- New `ProductTableBody.tsx` client wrapper enforcing one open product-edit
  form at a time; `ProductRow.tsx` becomes controlled (`isEditing` /
  `onEnterEdit` / `onExitEdit`)
- `overflow-x-auto` wrapper on the `productos`, `caja`, `categorias`, `pedidos`
  admin tables
- Button restyle for "Salir" and the row Guardar/Cancelar pair (DESIGN.md)
- Spec deltas: `storefront-browsing` (header category nav), `admin-console`
  (exclusive edit mode + narrow-viewport table behavior)

### Out of Scope (Non-Goals)

- Category data source, hrefs, or labels — unchanged
- Header cart entry point / badge behavior — unchanged
- Home-page category tiles — unchanged
- Responsive card/stacked reflow for admin tables (horizontal scroll only)
- Any API, service, Prisma, or data-model change
- Enshrining visual tokens/button styles in specs

## Capabilities

### New Capabilities

- None. All behavior lands under existing `storefront-browsing` and
  `admin-console` capabilities.

### Modified Capabilities

- `storefront-browsing`: gains a `Header Category Navigation` requirement — the
  category nav is a collapsed, keyboard-dismissible top-right dropdown, absent
  when there are no categories.
- `admin-console`: `Product and Variant Management` gains an exclusive-edit-mode
  guarantee; a new lightweight `Admin Console Layout on Narrow Viewports`
  requirement keeps each data table within page width.

## Approach

Exploration approaches 1 + 4 + 6 — all already shipped. `Header.tsx` stays a
synchronous prop-tested presentational component; open/close and edit state live
in the two new `"use client"` components, matching the codebase's existing
"RSC passes props to a client island" pattern. `page.tsx` for `productos` stays
a Server Component. Table overflow is a one-line CSS-utility wrapper per table.

## Decided by the owner (do not re-litigate)

| Decision | Rationale |
|---|---|
| Category nav collapses into a click dropdown, not a restyled static row | Declutters the top of every page; scales with category count |
| Opening a product edit row closes any other open one, discarding its unsaved edits | One "Guardar" is unambiguous; matches "FIFO of 1" |
| Admin tables get horizontal scroll, not a mobile card reflow | Admin is owner-only, low mobile priority; one-line fix vs. reworking 4 pages |

## Edge Cases

- Zero categories → `CategoryMenu` renders nothing
- Dropdown open then link click / `Escape` / outside click → closes; listeners cleaned up on unmount
- `Escape` in an open edit row → cancels that row, no save
- Open row A then "Editar" row B → A returns to view mode, unsaved edits dropped
- `onExitEdit` race guarded so a stale row can't clear another's open state
- Expanded variant/image sub-rows still render while editing core fields (the original "variants can't be edited" bug stays fixed)
- Empty product list → `ProductTableBody` renders the empty-state row

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/components/storefront/CategoryMenu.tsx` | New | Client disclosure dropdown |
| `src/components/storefront/Header.tsx` | Modified | Recomposed layout; consumes `CategoryMenu` |
| `src/app/admin/(console)/productos/ProductTableBody.tsx` | New | Exclusive-edit-mode client wrapper |
| `src/app/admin/(console)/productos/ProductRow.tsx` | Modified | Controlled via props; button restyle |
| `src/app/admin/(console)/productos/page.tsx` | Modified | Renders `ProductTableBody`; `overflow-x-auto` |
| `src/app/admin/(console)/{caja,categorias,pedidos}/page.tsx` | Modified | `overflow-x-auto` table wrapper |
| `src/app/admin/(console)/layout.tsx` | Modified | "Salir" button restyle |
| `src/app/admin/(console)/productos/ProductImages.tsx`, `.../nuevo/NewProductForm.tsx` | Modified | 1-line cosmetic touch |
| Prisma / API / services | Unchanged | No change |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Category links leave the a11y tree until the dropdown opens | Expected | Standard disclosure pattern; keyboard-dismissible; trigger is a labeled button with `aria-expanded` |
| Centered wordmark and absolute right cluster overlap at ~320px | Low | Visual check during verify/QA; jsdom tests can't catch layout |
| No focus return to trigger on close | Low | Accepted for a simple disclosure; follow-up if needed |

## Rollback Plan

Fully additive and separable. Delete `CategoryMenu.tsx` + `ProductTableBody.tsx`
and revert the touched files to restore the current header and per-row edit
behavior exactly. No migration, no schema change, no persisted state, no API
shape change.

## Dependencies

- None. No new package; everything ships with what is already in `package.json`.

## Success Criteria

- [ ] The storefront header shows the category nav as a collapsed top-right dropdown, closed by default
- [ ] Opening the dropdown lists one link per category to `/categoria/{slug}`; it closes on `Escape`, outside click, or selecting a link
- [ ] With no categories, no category-nav control renders
- [ ] Home-page category tiles and the header cart entry point are unchanged
- [ ] At most one product edit form is open at a time; opening another row's "Editar" closes the first with no save
- [ ] After Cancelar/`Escape`/successful save, any product row can be edited again
- [ ] Each admin data table stays within page width on narrow viewports, scrolling within its own container
- [ ] `tsc --noEmit`, `eslint`, and the component test suites for the changed files pass

## Delivery Note for `sdd-tasks`

One reviewable slice. The implementation is complete; tasks should be
verification/ratification steps (confirm each success criterion against the
working tree, run the focused test commands, spec-conformance check) plus the
`docs/bugs.md` reconciliation, not fresh implementation. Estimated changed lines
already in the tree: ~240 (well under the 800-line budget). No `sdd-design`.
