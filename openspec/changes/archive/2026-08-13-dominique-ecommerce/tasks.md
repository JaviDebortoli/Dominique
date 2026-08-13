# Tasks: Dominique — Pickup-Only E-Commerce MVP

> Strict TDD active. Every implementation task is preceded by its RED test (written first, failing) — shown here as combined `RED→GREEN` lines per skill word-budget rules; `RED→GREEN` means the test file is authored and run failing BEFORE the paired production code.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 6,000–12,000 (greenfield full-stack build: schema, 5 service modules, 3 storefront routes, admin console, payments, deploy configs, and matching unit/integration/E2E tests) |
| Session review budget | 800 lines (per preflight `review_budget_lines`) |
| 800-line budget risk | High — every phase individually likely exceeds 800 lines once tests are included |
| Chained PRs recommended | Yes |
| Suggested split | 8 work units (WU1–WU8), one per phase below |
| Delivery strategy (session) | single-pr |
| Chain strategy | pending — see Risk note below |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

**Risk note**: `delivery_strategy=single-pr` normally resolves to `size-exception` (one PR, maintainer sign-off). Given the true scope here — a full greenfield app across 8 spec domains plus deploy — a single PR is very unlikely to get a meaningful review even with an exception. Recommend the maintainer pick `feature-branch-chain` (WU1→WU8 stacked on a `dominique-ecommerce` tracker branch) or explicitly accept `size:exception` before `sdd-apply` starts. `chain_strategy` is left `pending` for that decision.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| WU1 | Scaffold + schema/migrations/seed + test tooling | PR 1 | `pnpm vitest run` (smoke) | `pnpm dev` boots | Delete scaffold; nothing else depends on it yet |
| WU2 | Catalog module (services only) | PR 2 | `pnpm vitest run src/modules/catalog` | N/A — no UI route yet | Revert `src/modules/catalog/**` |
| WU3 | Storefront browsing | PR 3 | `pnpm vitest run` + `pnpm playwright test home category pdp` | `pnpm dev` → `/`, `/categoria/[slug]`, `/producto/[slug]` | Revert `app/(store)/{page,categoria,producto}` |
| WU4 | Cart, checkout, `hold()` primitive | PR 4 | `pnpm vitest run src/modules/{cart,inventory,orders}` | Playwright checkout happy-path | Revert cart/checkout routes + `hold()` |
| WU5 | MercadoPago integration | PR 5 | `pnpm vitest run src/modules/payments app/api/webhooks` | MP sandbox webhook replay | Revert `payments/**`, webhook route; orders stay `PENDING_PAYMENT` |
| WU6 | Order lifecycle + sweep + pickup reservation | PR 6 | `pnpm vitest run src/lib/business-days src/jobs src/modules/orders` | Manual sweep run vs. seeded expired rows | Revert `expire-reservations.ts`, `business-days.ts` |
| WU7 | Admin console | PR 7 | `pnpm vitest run app/admin` + Playwright admin in-store-sale | Log in as seeded `AdminUser`, exercise `/admin/caja` | Revert `app/admin/**`, `middleware.ts` gate |
| WU8 | Deploy/ops | PR 8 | `bash -n deploy/backup.sh` + local dry-run | N/A — requires live DonWeb VPS, validated at cutover | Revert `deploy/**`; app code untouched |

## Phase 1: Scaffold, Schema, Test Tooling

- [x] 1.1 Init Next.js (TS, App Router) + Tailwind + ESLint.
- [x] 1.2 Add Vitest + Testing Library; RED→GREEN smoke test.
- [x] 1.3 Add Playwright; RED→GREEN smoke E2E test.
- [x] 1.4 Write `prisma/schema.prisma`: Category, Product, ProductImage, Variant(onHand, held, CHECK≥0), Order, OrderItem, Payment(mpPaymentId UNIQUE), StockMovement, AdminUser, StoreHours, Holiday, NewsletterSignup.
- [x] 1.5 Run initial `prisma migrate dev`.
- [x] 1.6 RED→GREEN: seed asserts StoreHours Mon–Fri open, Sat/Sun closed, zero holidays → `prisma/seed.ts`.
- [x] 1.7 Generate `tailwind.config.ts` from `ejemplo/DESIGN.md` tokens (0px radius, 1px borders, nude `#EBCFC4` CTA-only).

## Phase 2: Catalog Module

- [x] 2.1 RED→GREEN: product + variants saved linked (Product Structure) → `src/modules/catalog/product.service.ts`.
- [x] 2.2 RED→GREEN: duplicate size/color variant rejected (Variant Uniqueness) → `product.service.ts`.
- [x] 2.3 RED→GREEN: product requires exactly one category, listing filter works (Category Association) → `category.service.ts`.
- [x] 2.4 RED→GREEN: one size sold out, others remain purchasable (Per-Variant Stock) → variant availability helper.
- [x] 2.5 RED→GREEN: product without image still saves, flagged incomplete (Product without images) → `product.service.ts`.

## Phase 3: Storefront Browsing

- [x] 3.1 RED→GREEN: home renders nav, curated products, category entry points matching `ejemplo/code.html` → `app/(store)/page.tsx`.
- [x] 3.2 RED→GREEN: category page lists active products with price + thumbnail → `app/(store)/categoria/[slug]/page.tsx`.
- [x] 3.3 RED→GREEN: PDP size selector enables in-stock size, disables zero-stock size with "Sin stock" (es-AR) → `SizeSelector` component + `app/(store)/producto/[slug]/page.tsx`.
- [x] 3.4 RED→GREEN: add-to-cart enabled only for selected in-stock variant → `SizeSelector`.

## Phase 4: Cart, Checkout, `hold()`

- [x] 4.1 RED→GREEN: `hold()` conditional UPDATE decrements availability, 0 rows ⇒ `OutOfStockError` (D3) → `src/modules/inventory/stock.service.ts`.
- [x] 4.2 RED→GREEN (integration, real Postgres): N parallel `hold()` on last unit ⇒ exactly one success → `stock.service.ts`.
- [x] 4.3 RED→GREEN: cart stores exact variant + qty selected (Cart Holds Selected Variants) → `src/modules/cart/*`.
- [x] 4.4 RED→GREEN: checkout form has contact fields only, no address/shipping (Guest-Only, No Shipping) → `app/(store)/checkout/page.tsx`.
- [x] 4.5 RED→GREEN: checkout submit re-validates stock, rejects unavailable line (Stock Re-Validation) → `app/api/checkout/route.ts`.
- [x] 4.6 RED→GREEN: checkout creates `Order(PENDING_PAYMENT, expiresAt=+30min)` calling `hold()` in one tx (D5) → checkout route + `src/modules/orders/order.service.ts`.

## Phase 5: MercadoPago Integration

- [x] 5.1 RED→GREEN: preference created for `PENDING_PAYMENT` order, 303 to `init_point` → `src/modules/payments/mercadopago.ts` `createPreference()`.
- [x] 5.2 RED (threat matrix): forged/replayed webhook + tampered body amount ⇒ rejected, no state change → `app/api/webhooks/mercadopago/route.ts` test.
- [x] 5.3 GREEN: `x-signature` HMAC validation, ignore body amount/status, re-fetch via Get Payment API, always `200` after persist → webhook route.
- [x] 5.4 RED→GREEN: approved payment ⇒ same-tx `commitPaid()` (onHand-=q, held-=q, Order=PAID, StockMovement) — Atomic Stock Decrement HARD RULE → `stock.service.ts`.
- [x] 5.5 RED→GREEN: rejected/cancelled ⇒ `release()` held, Order=CANCELLED, no decrement → `stock.service.ts` + webhook route.
- [x] 5.6 RED→GREEN: MP `pending` ⇒ stays `PENDING_PAYMENT`, `expiresAt=+3d`, no decrement → webhook route.
- [x] 5.7 RED→GREEN: duplicate `mpPaymentId` ⇒ unique violation caught ⇒ `200` no-op, no double decrement → `Payment` constraint + route.
- [x] 5.8 RED→GREEN: redirect params never trusted; order stays pending until server confirms → `app/(store)/pedido/[code]/page.tsx` reads DB only.

## Phase 6: Order Lifecycle, Sweep, Pickup Reservation

- [x] 6.1 RED→GREEN (fake clock): next-open-business-day math — Mon–Fri open, Sat/Sun closed, `Holiday` skipped, after-hours rolls forward → `src/lib/business-days.ts`.
- [x] 6.2 RED→GREEN: pickup reservation creates `Order=RESERVED`, `hold()`s stock as reserved-unpaid → `order.service.ts`.
- [x] 6.3 RED→GREEN: `RESERVED` `expiresAt` = closing time of next open business day → `order.service.ts` using `business-days.ts`.
- [x] 6.4 RED→GREEN: sweep releases held for expired `RESERVED` and `PENDING_PAYMENT` rows, `Order=EXPIRED`, never touches `PAID`/`PICKED_UP` → `src/jobs/expire-reservations.ts` + `stock.service.ts` `release()`.
- [x] 6.5 RED→GREEN: `node-cron` runs sweep every 15 min inside PM2 process (D6) → `expire-reservations.ts` scheduler wiring.
- [x] 6.6 RED→GREEN: order lookup shows es-AR status labels (Pendiente/Pagado/Reservado/Listo para retirar/Retirado/Cancelado/Vencido) → `app/(store)/pedido/[code]/page.tsx`.
- [x] 6.7 RED→GREEN: staff marks picked up ⇒ terminal state, stock not touched again; reserved-unpaid→sold-paid only if not already `PAID` → `order.service.ts` `markPickedUp()`.

## Phase 7: Admin Console

- [x] 7.1 RED→GREEN: unauthenticated `/admin/*` request redirected to login, no data exposed → `src/proxy.ts` (Next.js 16 renamed `middleware.ts`) + Auth.js Credentials/bcrypt (D7).
- [x] 7.2 RED→GREEN: valid credentials issue session cookie → `app/admin/login/page.tsx` + auth config.
- [x] 7.3 RED→GREEN: owner creates product with variants/stock/images unaided, listed once active → `app/admin/productos/**` wired to catalog services.
- [x] 7.4 RED (threat matrix): upload `.svg`/`.html`/`.php`/JPEG-renamed-HTML ⇒ rejected, nothing written → upload route test.
- [x] 7.5 GREEN: magic-byte allow-list (jpeg/png/webp), `sharp` re-encode, random filename, store under `public/uploads/products` for local dev (D8 production target is `/var/dominique/uploads`, adapted per Phase 8) → `app/api/admin/upload/route.ts`.
- [x] 7.6 RED→GREEN: `/admin/caja` shows disponible/reservado/en depósito per row, `dynamic='force-dynamic'`, buyer+expiry on reserved rows → `app/admin/(console)/caja/page.tsx`.
- [x] 7.7 RED→GREEN: in-store sale decrements `onHand` via same conditional UPDATE + `StockMovement(IN_STORE_SALE)`, reflected online immediately → `stock.service.ts` `sellInStore()`.
- [x] 7.8 RED→GREEN: manual stock adjustment applies immediately across storefront + admin → `stock.service.ts` `adjust()` + admin route.
- [x] 7.9 RED→GREEN: staff updates order status, visible via customer lookup → `app/admin/(console)/pedidos/**`.
- [x] 7.10 RED→GREEN: caja stock view reflects MP decrement within seconds, distinguishes available/reserved-unpaid/sold-paid (HARD RULE) → `caja.service.ts` `getCajaRows()`.

## Phase 8: Deploy / Ops

- [x] 8.1 Write `deploy/nginx.conf`: reverse proxy, uploads `alias` with `default_type application/octet-stream` (no script exec), per-IP rate limit on webhook path.
- [x] 8.2 Write `deploy/ecosystem.config.js` PM2 process definition (Next.js server + in-process cron per D6).
- [x] 8.3 RED→GREEN: `deploy/backup.sh` nightly `pg_dump` produces a restorable dump (script test).
- [x] 8.4 Document Certbot/Let's Encrypt renewal cron in `deploy/DEPLOY.md`.
- [x] 8.5 Write `deploy/DEPLOY.md`: DonWeb provisioning, PM2/systemd, Nginx, Certbot, `migrate deploy`, rollback (repoint Nginx + restore `pg_dump`).
- [x] 8.6 Full-suite gate: `vitest run` + `playwright test` against seeded DB; verify sold-out-size-blocked, MP-sandbox-happy-path, admin-in-store-sale E2E scenarios.

## Open Items Carried Forward (from design.md)

- [x] Reword trust banner copy "Pagá al Retirar" → dual-payment phrasing (e.g. "Pagá online o al retirar") — Phase 3 or 8 content pass. **Already done in Phase 3** (`src/app/(store)/page.tsx` already reads "Pagá online o al retirar"; `ejemplo/code.html`'s original mockup copy was never carried into the actual implementation). No code change needed this phase — verified no test/snapshot asserts the old copy.
- [x] Confirm Newsletter capture is DB-only (no ESP) before Phase 2/7 `NewsletterSignup` wiring — proceed on that assumption unless owner objects. **Confirmed, and out of scope for this MVP**: `NewsletterSignup` exists in `prisma/schema.prisma` but is intentionally unwired — `src/components/storefront/Footer.tsx`'s newsletter form is presentation-only (no `onSubmit`, no API route), documented in that file's own module doc as "carried forward". Wiring it was never an assigned task in any Phase 1-8 tasks list, so this is an intentional MVP scope boundary, not a bug or regression.
