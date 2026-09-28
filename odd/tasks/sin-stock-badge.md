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
- [x] T1 — Pure helper `isProductSoldOut(variants)` in `variant-availability.ts` + unit tests. Commit: `00863e2`.
- [x] T2 — Listing queries include variant counters; tests in the service test files. Commit: `eb34360`.
- [x] T3 — `ProductCard` `soldOut` badge + component test; wire both pages (page tests if present). Commit: `520a3af`.

## Route per task
- Delegated direct (writer trigger: 2+ non-trivial files).

## Acceptance criteria
- A product whose every variant has available 0 shows "Sin stock" top-right on its card in home and category pages.
- A product with at least one available variant shows no badge.

## Checks
- `npm test`, `npm run lint`, `npx tsc --noEmit`.

## Progress
- Exploration done; branch created.
- T1: `isProductSoldOut` added to variant-availability.ts with unit tests (RED then GREEN, 8/8 passing). Commit `00863e2`.
- T2: `listProductsByCategory`/`listCuratedProducts` select `variants: { onHand, held }`; `ProductListItem`/`CuratedProduct` types updated; integration tests added (RED then GREEN, 61/61 passing in the two service test files). Commit `eb34360`.
- T3: `ProductCard` gets `soldOut: boolean`, renders "Sin stock" badge top-right (absolute right-2 top-2, bg-ink/text-paper, label-caps style) when true; card stays a link. `ProductCard.test.tsx` added (RED then GREEN, 3/3 passing). Both pages wired with `soldOut: isProductSoldOut(product.variants)`; existing page tests (`(store)/page.test.tsx`, `categoria/[slug]/page.test.tsx`) still pass unmodified (products in those fixtures have stock, so no badge assertion was needed to keep them green). Commit `520a3af`.
- Verification: `npx tsc --noEmit` clean; `npm run lint` — only the 2 known pre-existing AddVariantForm.tsx errors; full `npm test` exceeded the 120s foreground timeout, so ran targeted subset instead (all touched test files + `src/app/(store)` page tests) — all passing.

## Next step
- Feature complete; branch ready for PR/review at the user's discretion.
- Parent full-suite run: `npm test` 565/567; the 2 failures were in `order.service.test.ts` (untouched), pglite proxy `08P01` under load; that file alone passes 44/44.
- Native review (reliability lens): approved and acknowledged. Advisory follow-up: page-level tests with a sold-out fixture for home and category pages.
