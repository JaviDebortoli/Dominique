# Design: Header nav collapse + admin table UX

> Retrofit design. The code is already in the working tree (`tsc --noEmit` and
> `eslint` clean, component tests green). This document ratifies the shipped
> decisions and resolves the two questions `exploration.md` left open.

## Technical Approach

Three presentational fixes, no business logic. The architecture is unchanged:
Server Components fetch and pass plain props into narrowly scoped `"use client"`
islands. This change adds two such islands and moves state that was previously
misplaced (per-row) or absent (header nav) into them.

**Unchanged**: Prisma schema, `product.service` / `category.service`, the
`/api/admin/products/[id]` PATCH/DELETE contract, `HeaderProps`, category hrefs
and labels, cart badge derivation, home-page category tiles, admin table columns.

**No sequence diagrams apply.** `config.yaml` requires them for payment and
stock flows; this change touches neither — no MercadoPago path, no reservation,
no stock mutation, no server action beyond the pre-existing `signOutAction`.

## Component Architecture

    RSC (page/layout, data)  ──props──►  client island (interaction state)

| Component | Kind | State it owns | Why here |
|---|---|---|---|
| `Header.tsx` | sync presentational | none | Stays prop-tested and synchronous; adding `useState` would force `"use client"` on the whole header |
| `CategoryMenu.tsx` | `"use client"` | `open` + document listeners | Smallest unit that needs interactivity; returns `null` at zero categories so the header degrades cleanly |
| `productos/page.tsx` | Server Component | none | Keeps `await listAllProductsForAdmin` + `prisma.category.findMany` server-side |
| `ProductTableBody.tsx` | `"use client"` | `editingProductId` | An RSC cannot hold client state; this is the lowest common ancestor of all rows |
| `ProductRow.tsx` | `"use client"` | field drafts, `expanded`, `submitting` | Edit *mode* is now controlled by props; drafts stay local |

`ProductRow` moved from self-owned `mode: "view" | "edit"` to controlled
`isEditing` / `onEnterEdit` / `onExitEdit`. `enterEdit()` and `cancelEdit()`
still reseed drafts from `product` before delegating upward, so a discarded edit
never leaks into the next open. `expanded` deliberately stays local and
independent of `isEditing` — that independence is what fixes the original
"variants can't be edited" report.

## Edit-State Model — "FIFO of 1"

`editingProductId: string | null`. Setting it to a row's id opens that row and
implicitly closes any other; there is no close-then-open sequence to race.

Stale-row guard on exit:

```tsx
onExitEdit={() =>
  setEditingProductId((current) => (current === product.id ? null : current))
}
```

Row A's async save can resolve *after* the owner opened row B. An unguarded
`setEditingProductId(null)` would then close B. The functional updater makes the
clear conditional on still being the open row, so a stale row is a no-op.

## Admin Table Overflow

Chosen: exploration approach 6 — `<div className="overflow-x-auto">` around each
`<table>` in `productos`, `caja`, `categorias`, `pedidos`. Rejected approach 7
(mobile card reflow): reworks four pages for an owner-only console with low
mobile priority. The spec is written at behavior level ("stays within page
width, scrolls in its own container"), so approach 7 remains a valid future
implementation of the same requirement without a spec change.

## Resolved: Mobile Header Layout (~320px)

**Layout contract**: the wordmark is centered in flow; the cluster
(`CategoryMenu` + cart) is `absolute right-margin-mobile` and therefore out of
flow, so nothing in the shipped classes *guarantees* clearance — the wordmark
does not shrink or reflow when the cluster grows.

Measured estimate at 320px: content box 288px; wordmark ≈216px (32px Bodoni,
9 uppercase chars, `tracking-widest`); cluster ≈160px ("Categorías" label +
chevron + `gap-6` + bag + count). Combined ≈376px > 288px, so **overlap is
expected**, not merely possible.

**Decision**: absolute anchoring is retained only above the breakpoint where
clearance holds. If the browser check confirms overlap, the single sanctioned
remedy is to keep the cluster in normal flow at the narrow tier —
`justify-between` by default, promoting to `justify-center` + `absolute` at
`md:` — because flow layout cannot overlap. Shrinking the wordmark or hiding the
"Categorías" label was evaluated and rejected: at DESIGN.md's own tokens
(`headline-md` = 24px) the two boxes still collide, and dropping the label costs
the control its accessible name.

**Acceptance check** (jsdom cannot see this): render `/` at 320×568 with ≥3
categories and `cartCount ≥ 10`; the wordmark's right edge must not intersect
the cluster's left edge, and `document.documentElement.scrollWidth` must equal
the viewport width.

## Resolved: CategoryMenu ARIA

| Attribute | Decision | Rationale |
|---|---|---|
| `aria-haspopup` | **Omit** (shipped code has `="true"`) | ARIA maps `true` to `menu`; the panel is a `<nav>` of links with no `menuitem` roles or arrow-key model, so it promises an interaction that does not exist |
| `aria-expanded` | **Keep** on the trigger `<button>` | The one attribute the disclosure pattern actually requires; backs the spec's "marked as collapsed/expanded" scenarios |
| Panel role | **Keep `<nav aria-label="Categorías">`** | Truthful: it is a set of navigation links, and the label disambiguates it from other landmarks |
| Focus on open | **Do not move** — ratified | Correct for a disclosure; APG only requires moving focus for a true menu |
| Focus on close | **Ratified as-is, with a named follow-up** | Closing via `Escape` while focus is inside the panel drops focus to `<body>` and loses keyboard position. Not blocking (mouse and tab-through paths are fine); file a follow-up to restore focus to the trigger when the panel unmounts while containing `document.activeElement` |

Removing `aria-haspopup` is a one-line delta and the only code change this
design asks for beyond what is shipped.

## Rejected Alternatives

| Rejected | One-line reason |
|---|---|
| Hover-activated category menu (2) | No touch support; fails keyboard expectations; flaky in tests |
| Restyled static category row (3) | Does not solve the crowding and scales badly with category count |
| Per-row state + "close others" event bus (5) | Implicit coupling, harder to test, over-engineered for one table |
| Mobile card reflow for admin tables (7) | Four-page rework for an owner-only, low-mobile-priority console |
| Header owning the dropdown state | Would force `"use client"` on the whole header and break its synchronous prop tests |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file
classification, or process-integration boundary. Presentational client state
only; no new network call, no new server action, no auth surface.

## Migration / Rollout

No migration. Fully additive and revertible by deleting `CategoryMenu.tsx` and
`ProductTableBody.tsx` and reverting the touched files. No persisted state, no
schema change, no API shape change.

## Verification Hooks

Beyond `tsc --noEmit`, `eslint`, and the jsdom component suites:

- [ ] **320px header collision** — browser check per the acceptance check above. Automated tests cannot catch it.
- [ ] **ARIA attributes** — trigger is a `<button>` with `aria-expanded` toggling and **no** `aria-haspopup`; panel is `<nav aria-label="Categorías">`.
- [ ] **Keyboard dismissal** — `Escape` and outside `pointerdown` close the panel; listeners are removed on close and on unmount.
- [ ] **Admin overflow at 320px** — all four tables: page `scrollWidth` equals viewport width, table scrolls inside its wrapper, no column dropped.
- [ ] **Known non-blocker** — `page.test.tsx`'s real-Postgres integration case fails for lack of a local database; environmental, unrelated to this change.

## Open Questions

- [ ] None blocking. The `aria-haspopup` removal and the conditional narrow-viewport layout remedy are handed to `sdd-tasks`.
