# Design: Dominique — Pickup-Only E-Commerce MVP

## Technical Approach

One Next.js (App Router, TypeScript) process on a DonWeb VPS: PM2 → Nginx → Certbot. Storefront pages are React Server Components reading Prisma directly; every write goes through a domain service under `src/modules/{catalog,inventory,orders,payments,admin}`, so route handlers, server actions, admin, and the cron sweep share one inventory code path. Postgres is the only stateful dependency — no Redis, no queue, no worker. Tailwind theme is generated from `ejemplo/DESIGN.md` tokens (0px radius, 1px black borders, nude `#EBCFC4` for primary CTAs only); `ejemplo/code.html` is the markup reference for header, product card, and trust banner.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| D1 | Modular monolith: `app/` holds routes/UI only; business rules live in `src/modules/*` services | Separate API service; logic inside route handlers | In-store sale, webhook, and sweep must reuse the *same* decrement function; duplicating it is the oversell bug |
| D2 | **Two-counter stock**: `Variant.onHand` (units physically in store) + `Variant.held` (units committed to unpaid orders). `available = onHand - held` | Single `stock` column; separate `Reservation` rows summed per read | Distinguishes "paid" from "reserved" (rule 4b) while keeping availability a single indexed read |
| D3 | **Conditional UPDATE inside one Prisma `$transaction`** for every stock change (see Interfaces). `0 rows affected` ⇒ abort with `OUT_OF_STOCK` | `SELECT … FOR UPDATE` then update (extra round-trip); `SERIALIZABLE` + retry loop (retry complexity); app mutex/Redis (new infra) | Row-level atomic under Postgres default READ COMMITTED, safe for concurrent buyers, one statement, zero extra infrastructure |
| D4 | Webhook idempotency via `Payment.mpPaymentId UNIQUE`; duplicate insert → catch unique violation → `200` no-op | In-memory dedupe cache; status-only guard | MercadoPago retries and may deliver out of order; the DB constraint is the only trustworthy dedupe on a single small node |
| D5 | Short `held` hold at MP checkout submit (30 min), converted to an `onHand` decrement at confirmed payment | No hold until payment | Refines rule 4a rather than breaking it: `onHand` still only drops on server-verified payment, but the hold prevents "paid for an item sold in-store 2 minutes ago", whose only remedy is a refund |
| D6 | Expiry sweep = `node-cron` inside the PM2 process, every 15 min | systemd timer + internal HTTP endpoint; `pg_cron` | Single instance, so no leader election needed; no extra secret or unit file to operate |
| D7 | Guest checkout only; admin auth = Auth.js Credentials + bcrypt, session cookie, all `/admin/*` behind middleware | Customer accounts; third-party IdP | MVP scope; only staff need identity |
| D8 | Images stored on VPS disk under `/var/dominique/uploads`, served by Nginx `alias`; DB keeps path + alt text | S3/object storage; DB blobs | Lowest ops overhead; covered by the nightly backup already planned |

## Data Model Sketch

```
Category 1─* Product 1─* ProductImage
                  1─* Variant(size, color, sku UNIQUE, priceOverride,
                              onHand INT, held INT, CHECK onHand>=0, CHECK held>=0)
Order(id, publicCode UNIQUE, buyerName, phone, email, method:MP|PICKUP_CASH,
      status, expiresAt?, createdAt) 1─* OrderItem(variantId, qty, unitPrice)
Order 1─0..1 Payment(mpPaymentId UNIQUE, status, rawPayload, amount)
StockMovement(variantId, delta, reason, orderId?, actorId?, at)   -- audit ledger
AdminUser · StoreHours(weekday, opens, closes, closed) · Holiday(date) · NewsletterSignup
```

`Order.status`: `PENDING_PAYMENT | RESERVED | PAID | PICKED_UP | EXPIRED | CANCELLED`.
`expiresAt` is set at creation: `PENDING_PAYMENT` → +30 min. If the webhook reports MP status `pending` (Rapipago, Pago Fácil, bank transfer via MP — settles asynchronously, not the same as the pickup cash/transfer flow below), `expiresAt` is extended to **+3 days** (MP's standard voucher validity) and the order stays `PENDING_PAYMENT`. `RESERVED` (pickup cash/transfer reservation) → closing time of the **next open business day**, computed from `StoreHours` + `Holiday`.

**Confirmed defaults** (owner decision): `StoreHours` seed = Monday–Friday open, Saturday/Sunday closed (`closed=true`), no holidays pre-loaded — the owner adds `Holiday` rows via admin as needed.

## Sequence — Payment (MercadoPago)

```
Buyer          Next.js                     Postgres            MercadoPago
 │ POST /api/checkout                          │                    │
 ├──────────────▶│ tx: hold(items) ───────────▶│                    │
 │               │ Order=PENDING_PAYMENT       │                    │
 │               │ create preference ───────────────────────────────▶│
 │◀── 303 → init_point ─────────────────────────────────────────────│
 │ pays on MP hosted checkout ──────────────────────────────────────▶│
 │◀── back_url /pedido/{code} (display only — params NEVER trusted) ─│
 │               │◀── POST /api/webhooks/mercadopago ────────────────│
 │               │ GET /v1/payments/{id} (server, access token) ────▶│
 │               │◀── status=approved ───────────────────────────────│
 │               │ tx: INSERT Payment(mpPaymentId) ─┐                │
 │               │     onHand-=q; held-=q           │ atomic         │
 │               │     Order=PAID; StockMovement ◀──┘                │
 │               │ 200 OK ──────────────────────────────────────────▶│
```

`rejected`/`cancelled` → release `held`, `Order=CANCELLED`. `pending` (Rapipago/Pago Fácil/MP-transfer) → keep hold, stay `PENDING_PAYMENT`, extend `expiresAt` to now+3 days. Duplicate webhook → unique violation → `200`, no state change.

## Sequence — Stock & Reservation

```
                ┌─ hold(q):  UPDATE "Variant" SET held = held + q
                │            WHERE id=$1 AND onHand - held >= q     0 rows ⇒ 409
 checkout ──────┤
                ├─ MP approved      → onHand-=q, held-=q → PAID        (irreversible)
                ├─ pickup completed → onHand-=q, held-=q → PICKED_UP
                ├─ MP pending       → expiresAt = now()+3d, stays PENDING_PAYMENT
                └─ sweep every 15m  → held-=q → EXPIRED
                                      WHERE status IN ('RESERVED','PENDING_PAYMENT')
                                      AND expiresAt<now()
                                      (PAID/PICKED_UP are unreachable: no hold left
                                       and status excluded ⇒ rule 4 holds)

 in-store sale  → /admin/caja "Vender en local": onHand-=q via the same
                  conditional UPDATE + StockMovement(reason=IN_STORE_SALE)
```

**Admin `/admin/caja` (register screen, rule 4c)**: `export const dynamic = 'force-dynamic'`, no cache, 15 s client poll + manual refresh, SKU/name search. Each row shows `disponible / reservado / en depósito`, and reserved rows list buyer name and expiry so staff never hand over a held or paid garment. Selling in person is done *from this screen*, which is what keeps `onHand` truthful.

## File Changes (new — greenfield)

| Path | Purpose |
|------|---------|
| `prisma/schema.prisma`, `prisma/seed.ts` | Model above, migrations, seed |
| `src/modules/inventory/stock.service.ts` | `hold`, `commitPaid`, `release`, `sellInStore` — sole writers of `onHand`/`held` |
| `src/modules/orders/*`, `src/modules/payments/mercadopago.ts` | Lifecycle; preference creation + Get Payment client |
| `app/api/webhooks/mercadopago/route.ts` | Untrusted entry point; server-verified, idempotent |
| `app/(store)/**`, `app/admin/**` | Home, categoría, PDP, carrito, checkout, `/pedido/{code}`; admin login, productos, stock, caja, pedidos |
| `src/lib/business-days.ts`, `src/jobs/expire-reservations.ts` | Next-open-day math + node-cron sweep |
| `tailwind.config.ts`, `deploy/{nginx.conf,ecosystem.config.js,backup.sh}` | Tokens; proxy, PM2, nightly `pg_dump` |

## Interfaces

```sql
-- The single concurrency primitive (D3). Runs inside prisma.$transaction.
UPDATE "Variant" SET held = held + $2 WHERE id = $1 AND "onHand" - held >= $2;
UPDATE "Variant" SET "onHand" = "onHand" - $2, held = held - $2
  WHERE id = $1 AND "onHand" >= $2 AND held >= $2;
-- rowCount === 0  ⇒  throw OutOfStockError(variantId)  ⇒  transaction rollback
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit | next-open-business-day (holidays, closed days, after-hours), availability math, MP status mapping | Vitest, fake clock |
| Integration | Concurrent `hold` on last unit (N parallel transactions ⇒ exactly one success); webhook idempotency (same `mpPaymentId` ×3 ⇒ one decrement); sweep never touches `PAID` | Vitest + real Postgres (Docker/local), no mocked Prisma |
| E2E | MP sandbox happy path, reservation path, sold-out size blocked, admin in-store sale | Playwright, es-AR copy assertions |

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED test |
|---|---|---|---|
| Documentation-like / executable-file classification | **Applicable** — admin image upload | Allow-list `image/jpeg,png,webp` by magic bytes (not extension), re-encode via `sharp`, random filename, Nginx serves upload dir with `default_type application/octet-stream` and no script execution | Upload `.svg`/`.html`/`.php` and a JPEG-renamed HTML file ⇒ rejected, nothing written |
| Git repository selection | N/A — no VCS automation in the product | — | — |
| Commit state | N/A — no VCS automation | — | — |
| Push state | N/A — no VCS automation | — | — |
| PR commands | N/A — no PR automation | — | — |
| *(added)* Untrusted webhook intake | **Applicable** — public unauthenticated endpoint | Validate `x-signature` HMAC, ignore body amounts/status, re-fetch via Get Payment API, per-IP rate limit at Nginx, always answer `200` after persisting | Forged/replayed webhook and body-tampered amount ⇒ no state change |

## Migration / Rollout

No data migration — greenfield. `prisma migrate deploy` on release; Nginx keeps the holding page until cutover; rollback = repoint Nginx to the previous release dir + restore last `pg_dump`.

## Open Questions

- [x] D5 (30-min pre-payment hold at MP checkout submit): **approved by owner**.
- [x] MP `pending` (Rapipago/Pago Fácil/transfer) hold window: **3 days**, per MP's standard voucher validity.
- [x] `StoreHours` default: **Monday–Friday, closed Saturday/Sunday**. No 2026 holidays pre-loaded; owner adds via admin.
- [x] Trust banner copy "Pagá al Retirar" must be reworded for dual payment (e.g. "Pagá online o al retirar"). **Resolved** — already implemented in Phase 3 (`src/app/(store)/page.tsx`).
- [x] Newsletter: DB capture only, or ESP later? (proposal assumption: DB capture only — carry forward to tasks unless owner objects). **Resolved** — DB-only for this MVP, confirmed at Phase 8; `NewsletterSignup` schema model exists but its UI form is intentionally unwired (never an assigned task).
