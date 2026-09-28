# Feature: "Sin stock" badge on catalog product cards

## Objective
When no variant of a product has available stock, its catalog card (home curated section and category listing) shows a "Sin stock" badge in the top-right corner of the thumbnail.

## Problem / Why
Catalog cards (`ProductCard`) carry no stock data today; shoppers only discover a product is sold out after opening its PDP.

## Scope (authorized)
- Listing queries (`listProductsByCategory`, `listCuratedProducts`) also load variant stock counters (`onHand`, `held`).
- A pure helper decides "sold out": no variant with `available > 0` (reuse `variant-availability.ts`; zero variants counts as sold out since nothing is purchasable).
- `ProductCard` gets a `soldOut` flag and renders a "Sin stock" badge top-right over the image.
- Both pages (`(store)/page.tsx`, `(store)/categoria/[slug]/page.tsx`) pass the flag.
- Out of scope: hiding sold-out products, reordering, PDP changes.

## Constraints
- available = onHand - held lives only in `variant-availability.ts`.
- UI copy in es-AR ("Sin stock", same label as the PDP).

## TDD
- Mode: enabled. Source: `openspec/config.yaml` (`tdd: true`). Runner: `npm test` (vitest).

## Delivery
- Branch: `feat/sin-stock-badge` (from `main`, independent of `feat/comprar-ahora`). Strategy: `ask-on-risk`. Forecast: ~150 authored changed lines.

## Tasks
- [ ] T1 — Pure helper `isProductSoldOut(variants)` in `variant-availability.ts` + unit tests.
- [ ] T2 — Listing queries include variant counters; tests in the service test files.
- [ ] T3 — `ProductCard` `soldOut` badge + component test; wire both pages (page tests if present).

## Route per task
- Delegated direct (writer trigger: 2+ non-trivial files).

## Acceptance criteria
- A product whose every variant has available 0 shows "Sin stock" top-right on its card in home and category pages.
- A product with at least one available variant shows no badge.

## Checks
- `npm test`, `npm run lint`, `npx tsc --noEmit`.

## Progress
- Exploration done; branch created.

## Next step
- T1–T3 via one delegated writer.
