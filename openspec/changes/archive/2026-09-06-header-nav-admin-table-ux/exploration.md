# Exploration: Header nav collapse + admin table UX

> This change documents an **already-implemented, uncommitted** working-tree
> refactor so `sdd-propose` / `sdd-spec` can retrofit specs onto it. Static
> checks pass (`tsc --noEmit` clean, `eslint` clean, component tests green;
> the one failing case is `page.test.tsx`'s real-Postgres integration test,
> environmental). No behavior below still needs building.

## Problem Statement

Three unrelated UX defects in shipped surfaces, fixed together because they are
all small, presentational, and touch no business logic:

1. **Storefront header is crowded.** The category nav rendered as a static
   horizontal row directly under the "Dominique" wordmark (`Header.tsx` was
   `flex-col`: wordmark, then nav, then an absolutely-positioned cart link).
   With more than a couple of categories this row competes with the wordmark
   and the pickup banner for the top of every page.
2. **Admin data tables overflow on narrow viewports.** `/admin/productos`,
   `/admin/caja`, `/admin/categorias`, `/admin/pedidos` each render a wide
   `<table>` with no horizontal-scroll container, so on a phone the table
   pushes past the layout instead of scrolling within it.
3. **Multiple product edit forms could be open at once.** Each `ProductRow`
   owned its own `mode` state, so staff could click "Editar" on several
   products simultaneously with no indication which "Guardar" applied to
   which row.

## Current State (pre-change, still in `git` HEAD)

- **`Header.tsx`** — synchronous presentational component. Row is
  `flex flex-col`: `<Link>Dominique</Link>`, then a `<nav>` mapping
  `categories` to `/categoria/{slug}` links, then an `absolute` cart `<Link>`
  to `/carrito` with a server-derived `cartCount` badge. `categories` and
  `cartCount` are plain props from `StoreLayout` (`app/(store)/layout.tsx`),
  which reads categories via `listCategoriesWithThumbnail` and `cartCount`
  from the cart cookie. Backed by `specs/storefront-browsing/spec.md`
  "Home Page Layout" ("navigation ... matching the mockup") and
  "Header Cart Entry Point".
- **`ProductRow.tsx`** — client component owning one `<tr>`. Held local
  `const [mode, setMode] = useState<"view" | "edit">`. "Editar" set edit
  mode; each row was fully independent. Save/Cancel buttons were plain
  text/underline styles. Backed by `specs/admin-console/spec.md`
  "Product and Variant Management" (all the PATCH/DELETE scenarios).
- **`admin/(console)/productos/page.tsx`** — Server Component; mapped
  `products` directly to `<ProductRow>` inside a bare `<table>`.
- **`admin/(console)/{caja,categorias,pedidos}/page.tsx`** — each renders a
  bare wide `<table>` with no scroll wrapper.
- **`admin/(console)/layout.tsx`** — "Salir" was a bare underlined text link.
- No spec requirement covers admin table responsiveness, category-nav
  *presentation* (only "matching the mockup"), or concurrent-edit behavior
  in the product table.

## Target State (what the working tree now does)

### Storefront header
- **New `CategoryMenu.tsx`** (`"use client"`) — a disclosure dropdown. Trigger
  `<button>` labeled "Categorías" with `aria-haspopup="true"` /
  `aria-expanded`, a rotating chevron. Opens on click; closes on `Escape`,
  outside `pointerdown`, or link click (listeners attached only while open).
  Renders `null` when `categories.length === 0`. Open panel is a
  `<nav aria-label="Categorías">` of the same `/categoria/{slug}` links.
- **`Header.tsx`** — row is now `flex ... justify-center` with a centered
  wordmark and one `absolute right-...` cluster holding `<CategoryMenu>` +
  the cart `<Link>`. Same categories, same hrefs, same cart badge behavior,
  same `HeaderProps` (`categories`, `cartCount`). Cart link keeps its
  hand-drawn 1px-stroke bag SVG and `aria-label="Carrito, N artículos"`.
- **`Header.test.tsx` / `page.test.tsx`** — updated to open the dropdown
  before asserting on category links. `page.test.tsx` still asserts the home
  page keeps its own category *tiles* (`categoryLinks.length >= 2` = dropdown
  + tile), so home-page category entry points are unchanged.

### Admin product table — exclusive edit mode
- **New `ProductTableBody.tsx`** (`"use client"`) — sits between the Server
  Component `page.tsx` and `ProductRow`. Owns
  `const [editingProductId, setEditingProductId] = useState<string | null>`
  and renders the `<tbody>` (including the empty-state row). Opening "Editar"
  on any row sets that row as the sole open one ("FIFO of 1" — opening one
  closes any other).
- **`ProductRow.tsx`** — drops local `mode`; now controlled via
  `isEditing` / `onEnterEdit` / `onExitEdit` props. `enterEdit` / `cancelEdit`
  still reseed the field state from `product`. Successful save calls
  `onExitEdit()` + `router.refresh()`. Save/Cancel restyled to the DESIGN.md
  button system: primary = filled `bg-nude`, secondary = 1px-border, both
  `disabled` while submitting, primary shows "Guardando…". Expanded
  variant/image sub-rows remain gated on the independent `expanded` flag.
- **`page.tsx`** — renders `<ProductTableBody products= categories= />`
  instead of mapping rows; `<table>` wrapped in `<div className="overflow-x-auto">`.

### Admin table overflow + chrome
- `caja/page.tsx`, `categorias/page.tsx`, `pedidos/page.tsx` — each `<table>`
  wrapped in `<div className="overflow-x-auto">`; horizontal scroll on narrow
  viewports instead of layout overflow. No data/column changes.
- `layout.tsx` — "Salir" restyled from underline link to a 1px-bordered
  button (DESIGN.md secondary button), still submitting `signOutAction`.
- `ProductImages.tsx`, `nuevo/NewProductForm.tsx` — 1-line cosmetic touch each.

## Approaches Considered

This is essentially "document what was built." The implementation is done; the
alternatives below are recorded for the spec retrofit, not as open decisions.

| # | Approach | Pros | Cons | Effort |
|---|----------|------|------|--------|
| 1 | **Collapse category nav into a click dropdown; own component holds open/close state; Header stays synchronous** (chosen, shipped) | Header stays a plain prop-tested presentational component; declutters the top of every page; keeps identical hrefs/labels; degrades to `null` with no categories | Category links leave the a11y tree until opened; adds one client component + document-level listeners | Low — done |
| 2 | Hover-activated menu | No click needed | No touch support; fails keyboard / reduced-motion expectations; flaky in tests | Low |
| 3 | Keep the static row, just restyle it | Zero new component | Doesn't solve the crowding; still scales badly with category count | Trivial |
| 4 | **Lift edit state to a `ProductTableBody` client wrapper** (chosen, shipped) | Enforces one-open-at-a-time; keeps `page.tsx` a Server Component; `ProductRow` becomes a controlled component (more testable) | New intermediate component; `ProductRow` API grows 3 props | Low — done |
| 5 | Keep per-row state, add a global "close others" event bus | No new component | Implicit coupling; harder to test; over-engineered for a table | Medium |
| 6 | **`overflow-x-auto` wrapper per table** (chosen, shipped) | One-line, framework-idiomatic, no column logic | Horizontal scroll is a mediocre mobile experience vs. a card reflow | Trivial — done |
| 7 | Responsive card/stacked layout for admin tables on mobile | Best mobile UX | Large rework of 4 pages; admin is owner-only, low mobile priority | High |

## Recommendation

Ratify the shipped implementation (approaches 1 + 4 + 6). All three are the
minimal, DESIGN.md-consistent fix for their respective defect and introduce no
business-logic change. Proceed straight to `sdd-propose` → `sdd-spec`; skip
`sdd-design`.

## Specs That Need Deltas

1. **`specs/storefront-browsing/spec.md`** — add a dedicated
   `Requirement: Header Category Navigation`. Scenarios:
   - Category navigation is presented as a collapsed top-right "Categorías"
     dropdown, not a static row; closed by default.
   - Opening it (click) reveals one link per category to `/categoria/{slug}`;
     it closes on `Escape`, outside click, or selecting a link.
   - When there are no categories, no category-nav control renders.
   - Home-page category tiles / entry points are unaffected (still present).
   - "Header Cart Entry Point" behavior unchanged; the cart link now sits in a
     right-side cluster alongside the category menu.
2. **`specs/admin-console/spec.md` — MODIFY `Requirement: Product and Variant Management`**
   Add scenarios:
   - At most one product row's edit form is open at a time; opening "Editar"
     on another row closes the first with no save.
   - After Cancelar/Escape/successful save, that row closes and any row can be
     edited again.
3. **`specs/admin-console/spec.md` — ADD `Requirement: Admin Console Layout on Narrow Viewports`**
   - Each admin data table (`/admin/productos`, `/admin/caja`,
     `/admin/categorias`, `/admin/pedidos`) MUST remain within the page width
     on narrow viewports, scrolling horizontally within its own container
     rather than overflowing the layout.

Button styling (Salir, Guardar/Cancelar) is DESIGN.md compliance, too granular
to spec — the project does not enshrine visual tokens in specs. Omitted.

## Is `sdd-design` Warranted?

**No.** Lean. This is presentational/mechanical: one disclosure component, one
state-lifting wrapper, a CSS utility wrapper on four tables, and button
restyles. No data model, API, service, migration, or cross-module contract
changes. No architectural fork. The one structural choice (Header stays
synchronous; `CategoryMenu` / `ProductTableBody` own the client state) is
already the established pattern in this codebase. `sdd-spec` + `sdd-tasks` are
sufficient.

## Open Questions

1. **`aria-haspopup="true"` vs `"menu"` vs omitting it.** The panel is a
   `<nav>` of links, not a `role="menu"`. The spec pins "disclosure, keyboard
   dismissible", not a strict menu ARIA pattern.
2. **Focus management.** Opening the dropdown does not move focus into the
   panel, and closing does not restore focus to the trigger. Accepted for a
   simple disclosure; a follow-up can add focus return on `Escape` if needed.
3. **Mobile header collision (~320px).** Centered wordmark + `absolute` right
   cluster: needs a visual check on the narrowest viewports; not covered by the
   jsdom component tests. Verify during `sdd-verify` / manual QA.
4. **Admin narrow-viewport requirement scope.** Speced at behavior level
   ("stays within page width, scrolls within its container"), not tied to the
   `overflow-x-auto` implementation detail.
5. **The 1-line touches** in `ProductImages.tsx` / `NewProductForm.tsx` are
   purely cosmetic (button class alignment); no spec impact.
6. **`page.test.tsx` real-Postgres failure** is environmental ("no local
   Postgres"), not caused by this change. `sdd-verify` should note it, not
   block.

## Edge Cases (all handled in the implementation)

- **Zero categories** → `CategoryMenu` renders `null`; header shows only
  wordmark + cart. Test: "renders nothing when there are no categories".
- **Dropdown open + navigate** → link `onClick` calls `setOpen(false)`;
  listeners cleaned up on unmount.
- **`Escape` while a product edit form is open** → `ProductRow`'s
  `handleFormKeyDown` calls `cancelEdit()` → `onExitEdit()`; parent clears
  `editingProductId`.
- **Save succeeds** → `onExitEdit()` + `router.refresh()`; row returns to view
  mode with fresh server data.
- **Open row A, then click Editar on row B** → `setEditingProductId(B)` — row A
  re-renders in view mode, unsaved edits discarded (by design; matches
  "opening one closes any other"). Test covers this.
- **`onExitEdit` race** → guarded:
  `setEditingProductId((current) => current === product.id ? null : current)`
  so a stale row can't clear another row's open state.
- **Expanded variant/image sub-rows while editing core fields** → still render
  (gated on `expanded`, independent of `isEditing`); explicitly tested — this
  was the original "variants can't be edited" bug.
- **Empty product list** → `ProductTableBody` renders the
  "Todavía no hay productos." row.
- **Narrow admin viewport** → table scrolls inside `overflow-x-auto`; page
  chrome unaffected.

## Ready for Proposal

Yes. All facts verified against the current working tree. Next: `sdd-propose`,
then `sdd-spec` (+ `sdd-tasks`); no `sdd-design`.
