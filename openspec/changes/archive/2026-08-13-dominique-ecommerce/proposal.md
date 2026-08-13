# Proposal: Dominique — Pickup-Only E-Commerce MVP

## Intent

Dominique sells "talles reales" womenswear only in-store and by Instagram DM. Manual order-taking costs staff hours, hides per-size availability, and loses sales after hours. Build the first online store: browse real stock, pay online or reserve, pick up at Plata 192.

## Scope

### In Scope
- Catalog: categories, products, size/color variants, per-variant stock, images
- Storefront (es-AR): home per mockup, category listings, PDP with size selector, cart
- Pickup-only checkout: contact data, no address, no shipping
- Dual payment: MercadoPago (server-verified) or cash/transfer reserved at pickup
- Order lifecycle: pending → paid | reserved → ready for pickup → picked up | cancelled/expired
- Stock shared with the physical store: decrement on order, reservation expiry, admin reconciliation
- Admin panel: auth, product/variant/stock CRUD, image upload, order status updates
- VPS deploy: Nginx, TLS, PM2/systemd, nightly backups
- Design tokens extended to PDP, cart, checkout

### Out of Scope
- Shipping/carrier integration; multi-store or multi-location
- Customer accounts (guest checkout only)
- Loyalty, promotions engine, marketing automation, i18n
- Returns/exchanges workflow ("Cambios" stays informational)
- Live Instagram API feed (static curated images)
- Newsletter beyond storing emails, no ESP integration — confirm

## Capabilities

### New Capabilities
- `product-catalog`, `storefront-browsing`, `cart-checkout`, `payment-mercadopago`, `pickup-reservation`, `order-lifecycle`, `inventory-stock`, `admin-console`

### Modified Capabilities
- None — greenfield repository.

## Approach

One Next.js/TypeScript codebase (storefront + admin + route handlers), PostgreSQL via Prisma, Tailwind seeded from `ejemplo/DESIGN.md` tokens. MercadoPago Checkout Pro; the webhook confirms status through the Get Payment API and is idempotent per payment id. Stock is decremented inside the order transaction; reservations hold stock for a bounded window, then auto-release. PM2 behind Nginx, Certbot TLS, nightly `pg_dump`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/` | New | SDD scaffold |
| `app/`, `components/` | New | Storefront + admin UI |
| `prisma/` | New | Schema, migrations, seed |
| `app/api/webhooks/mercadopago` | New | Payment verification |
| `ejemplo/` | Unchanged | Design reference only |
| VPS ops | New | Nginx, PM2, TLS, backups |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Overselling against in-store sales | High | Transactional decrement, reservation expiry, admin reconciliation |
| Trusting client redirect as payment proof | Med | Server-side Get Payment + idempotent webhook |
| MercadoPago pending states | Med | Model `pending` explicitly in the lifecycle |
| Single VPS failure | Med | Nightly backups, documented restore |
| PDP/cart/checkout not mocked | Med | Design phase derives them from tokens |

## Rollback Plan

No live system exists. Keep the current holding page until cutover; revert by repointing Nginx to the previous release directory and restoring the last `pg_dump`. Slices ship as independent revertible PRs.

## Dependencies

- MercadoPago Argentina seller account + sandbox credentials
- DonWeb VPS, domain, DNS
- Owner-supplied photos, prices, and stock counts

## Success Criteria

- [ ] Order paid via MercadoPago and confirmed server-side
- [ ] Order reserved for cash/transfer at pickup
- [ ] Owner adds a product with size variants unaided
- [ ] A sold-out size cannot be purchased
- [ ] Home matches the mockup; new screens reuse the same tokens
- [ ] Live on HTTPS with nightly backups

## Open Decisions

Newsletter = DB capture only? Reservation hold duration? Guest-only checkout confirmed? Ready-for-pickup notification channel? Trust-banner copy "Pagá al Retirar" must be updated to reflect dual payment.
