# Feature: Size + color selector on the product detail page

## Objective
Let shoppers pick a size and then a color available for that size on the PDP, instead of seeing one indistinguishable button per variant.

## Problem / Why
Each variant is a size + color pair, but `SizeSelector` renders one button per variant labeled only with `variant.size` (`SizeSelector.tsx:78`); the PDP never passes color. A product with "M Negro" and "M Blanco" shows two identical "M" buttons. `openspec/specs/storefront-browsing/spec.md:31` requires a size/color selector with real-time per-variant stock.

## Scope (authorized)
- Size buttons: one per distinct size (stable order of first appearance). A size is enabled when at least one of its variants is available; otherwise disabled with the existing "Sin stock" label.
- After a size is selected, color buttons for that size's variants; unavailable colors disabled ("Sin stock").
- Exactly one color for the selected size -> auto-selected (single-color products behave as today).
- Changing size clears the color selection (unless auto-selected).
- "Agregar al carrito" (existing in-cart cap per variant) and "Comprar ahora" act on the selected variant (size + color) and are enabled only for an available selected variant.
- PDP passes `color` in the variant options.
- Cart/checkout labels show the color if they currently omit it (verify in `cart-lines.ts`; change only if missing).

## Constraints
- available = onHand - held stays in `variant-availability.ts`.
- UI copy es-AR. Accessible groups: `role="group"` with aria-labels "Talle" and "Color", `aria-pressed` on buttons (match existing pattern).
- Keep component name/props backward compatible where reasonable (rename optional; document if renamed).

## TDD
- Mode: enabled. Source: `openspec/config.yaml` (`tdd: true`). Runner: `npm test` (vitest).

## Delivery
- Branch: `feat/selector-color` (from `main`). Strategy: `ask-on-risk`. Forecast: ~250 authored changed lines.

## Tasks
- [x] T1 — Selector logic + UI: distinct sizes, color step, auto-select single color, buttons act on selected variant. Tests in `SizeSelector.test.tsx` (multi-color size, sold-out color disabled, auto-select, size change resets color, buy-now/add-to-cart use the right variant id). Commit: `818a026`.
- [x] T2 — PDP passes `color`; `producto/[slug]/page.test.tsx` needed no change (fixtures already included color). Cart/checkout label was missing color in `cart-lines.ts`; added, with test. Commit: `42defe4`.

## Route per task
- Delegated direct (writer trigger: 2+ non-trivial files).

## Acceptance criteria
- A product with M Negro (stock) and M Blanco (no stock) shows one "M" button; selecting it shows Negro enabled and Blanco disabled "Sin stock".
- Single-color products: selecting a size is enough to enable the purchase buttons.

## Checks
- `npm test`, `npm run lint`, `npx tsc --noEmit`.

## Progress
- Exploration done; branch created.
- T1 done: `SizeSelector.tsx` now renders distinct size buttons (dedup by
  first appearance), then a `role="group" aria-label="Color"` step for the
  selected size's variants, auto-selecting when a size has exactly one
  color. Both purchase buttons act on the resulting size+color variant id.
  `SizeSelector.test.tsx` updated (existing fixtures gained a single `color`
  per size, preserving old behavior via auto-select) and extended with a
  `size + color two-step selection` describe block. RED: 6 failed/12 passed
  (new tests failing against pre-T1 component). GREEN: 18/18 passed.
- T2 done: `producto/[slug]/page.tsx` now maps `color` into the variant
  options passed to `SizeSelector`; its integration test needed no changes
  (fixtures already created variants with `color`). `cart-lines.ts`'s
  `ResolvedCartLine.label` was missing color (`"{name} — Talle {size}"`
  only) — it's used for `CartLineControls`' aria-labels and the checkout
  form/409 variantId→label mapping, not for /carrito's or /checkout's
  visible "Talle {size}" text, which stays as-is (out of scope per this
  doc's "verify in cart-lines.ts" note). New label:
  `"{name} — Talle {size} — Color {color}"`. RED: 1 failed/8 passed.
  GREEN: 9/9 passed.
- Full target suite (`SizeSelector`, `(store)` app dir, `cart`):
  16 files / 101 tests passed. `npm run lint`: only the 2 known pre-existing
  `AddVariantForm.tsx` errors. `npx tsc --noEmit`: clean.

## Next step
- Feature complete; ready for the parent's full-suite run and review.
- Parent: full `npm test` 586/586 passed on a1f64fa.
- Parent fix: /carrito visible line text now shows "Talle {size} · Color {color}" (was size only; two colors of one size looked identical). TDD: RED (carrito page test) then GREEN; e2e label constants updated to the new cart-lines label format (not run live). tsc + eslint clean.
- Follow-up done: test for a multi-color size whose colors are all sold out (size disabled, single "Sin stock", no color step, purchase disabled). Characterization test: behavior already existed; mutation check (forcing isSizeAvailable=true) made it fail, then restored. 19/19 SizeSelector tests pass.
- Review follow-up: rewrote that test to drop the no-op click on a disabled button and scope "Sin stock" to the XL size container, with a self-contained fixture (M mixed, XL all sold out). Mutation checks (isSizeAvailable forced true; some -> every) both fail it; source restored.
