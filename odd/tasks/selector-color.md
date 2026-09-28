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
- [ ] T1 — Selector logic + UI: distinct sizes, color step, auto-select single color, buttons act on selected variant. Tests in `SizeSelector.test.tsx` (multi-color size, sold-out color disabled, auto-select, size change resets color, buy-now/add-to-cart use the right variant id).
- [ ] T2 — PDP passes `color`; update `producto/[slug]/page.test.tsx` if needed. Cart/checkout label includes color if missing (with test).

## Route per task
- Delegated direct (writer trigger: 2+ non-trivial files).

## Acceptance criteria
- A product with M Negro (stock) and M Blanco (no stock) shows one "M" button; selecting it shows Negro enabled and Blanco disabled "Sin stock".
- Single-color products: selecting a size is enough to enable the purchase buttons.

## Checks
- `npm test`, `npm run lint`, `npx tsc --noEmit`.

## Progress
- Exploration done; branch created.

## Next step
- T1–T2 via one delegated writer.
