# Design: Completar el carrito de compras

## Technical Approach

Finish the cookie-only cart with no new architecture. One new Server Component route (`/carrito`) plus one client island for per-line controls; one new server-only resolver shared by `/carrito` and `/checkout`; three mutating Server Actions in the existing `"use server"` module; one `clearCart()` call in the checkout Route Handler. No dependency, no migration, no cart persistence beyond the single `dominique_cart` cookie.

All framework claims below were verified against the installed `next@16.3.0` source, not assumed.

## Architecture Decisions

### D1 — Shared line resolution lives in a new `src/modules/cart/cart-lines.ts`, not in `cart-cookie.ts`

| Option | Tradeoff |
|---|---|
| Add `resolveCartLines` to `cart-cookie.ts` | **Rejected — impossible.** That file is `"use server"`; every export becomes a client-callable Server Action endpoint. A resolver taking a `PrismaClient` cannot be one. |
| Duplicate the query in each page (today's state) | Rejected — the proposal's own Risk row ("two divergent line-rendering implementations"). |
| **New `src/modules/cart/cart-lines.ts`, `resolveCartLines(db, cart)`** | **Chosen.** Matches the project's D1 convention (`getProductBySlug(prisma, slug)`, `createCategory(prisma, input)` — client passed explicitly), stays unit-testable with a stubbed `db`. |

### D2 — Header stays a synchronous presentational component; `StoreLayout` reads the cookie

| Option | Tradeoff |
|---|---|
| `Header` becomes `async` and calls `getCart()` itself | Rejected — breaks the existing convention that `Header` receives `categories` from the layout, and makes the component untestable as a plain prop render. |
| **`StoreLayout` computes `cartCount`, passes it to `Header`** | **Chosen.** One cookie read at the boundary that already pays the dynamic-render cost; Header stays pure and prop-tested. |

Badge count = `cart.reduce((n, l) => n + l.qty, 0)` from the **cookie only** — no Prisma. A badge on every storefront page must not cost a DB round-trip. Consequence: a deleted-product line still counts toward the badge; `/carrito` is where the drop is named. Accepted.

**Accepted cost:** reading `cookies()` in the `(store)` layout makes every storefront route dynamic (home, `/categoria/[slug]`, `/producto/[slug]`). This is arguably a correction — those pages render live `onHand - held` and should never have been served from a static prerender on single-digit inventory. Flagged because the proposal did not state it.

### D3 — Badge refresh uses `refresh()` from `next/cache`, not `revalidatePath("/", "layout")`

Verified in `node_modules/next/dist/server/app-render/action-handler.js:990`:

```js
skipPageRendering ||= workStore.pathWasRevalidated === undefined
  || workStore.pathWasRevalidated === ActionDidNotRevalidate;
```

**A Server Action that only writes a cookie does not re-render anything.** Next has no cookie-mutation detection (see the TODO at `server-action-reducer.js:229`). Without an explicit revalidation signal the badge silently desyncs — this is the proposal's "Header badge count desyncs" risk, and it is real, not hypothetical.

| Option | Tradeoff |
|---|---|
| `router.refresh()` in the client island | Rejected — a second round-trip after the action, and it cannot fix the PDP path where `addOneToCart` is passed straight to `SizeSelector`. |
| `revalidatePath("/", "layout")` | Rejected — sets `ActionDidRevalidateStaticAndDynamic` (`revalidate.js:215`), purging the Full Route Cache for the whole store on every `+`/`−` click. |
| **`refresh()` from `next/cache`** | **Chosen.** Sets `ActionDidRevalidateDynamicOnly` (`revalidate.js:83`) — "only revalidates the dynamic data on the client. It doesn't affect cached data." Exactly the badge's need. |

Mechanics end-to-end, concretely: action writes the cookie → `refresh()` sets `pathWasRevalidated` → `skipPageRendering` becomes `false` → the `finally` block at `action-handler.js:996-1003` flips `requestStore.phase` to `'render'` and calls `synchronizeMutableCookies(requestStore)` so **the re-render's `cookies()` returns the cart just written** → `generateFlight` renders the current tree including `(store)/layout.tsx` → Header re-renders with the new `cartCount`. No manual reload, no client state.

**`refresh()` must NOT go in `writeCart()` or `clearCart()`**: `revalidate.js:73` throws `E870` when `workStore.page.endsWith('/route')` or the phase is not `'action'`. `clearCart()` runs from a Route Handler. Place `refresh()` only in the exported mutating actions.

### D4 — `clearCart()` is called in the Route Handler, not `order.service.ts`

Insertion point: `src/app/api/checkout/route.ts`, inside `POST`, **immediately after `const order = await createPendingOrder(prisma, validated)` (line 209) and before the `order.method === "MP"` branch (line 211)** — so one call covers both the 201 JSON and the 303 redirect.

Verified writable from that context: `node_modules/next/dist/server/route-modules/app-route/module.js:520-529` merges `requestStore.mutableCookies` into **whatever Response the handler returns**, rebuilding it with `{status, statusText, headers}` preserved. The `Set-Cookie` therefore rides the `NextResponse.redirect(initPoint, 303)` as well as the JSON 201. `order.service.ts` stays unchanged — it takes a `PrismaClient` and must not acquire a Next request-scope dependency.

Wrap in `try/catch`-and-ignore: per the proposal's edge case, a failed cookie write must never fail a created order.

### D5 — `/carrito` cannot self-heal the cookie

`areCookiesMutableInCurrentPhase` (`request-cookies.d.ts:21`) is false during render, so a Server Component cannot prune dropped lines. The notice therefore persists until the shopper uses that line's explicit **Eliminar** action. This is a framework constraint, not a preference — and it happens to match the proposal's "name it, don't silently filter" decision.

## Data Flow

```
PDP / /carrito (client island)
   │ Server Action (.bind(null, variantId))
   ▼
cart-cookie.ts ──► cart.ts (pure) ──► writeCart() ──► Set-Cookie
   │                                                      │
   └── refresh()  ──► pathWasRevalidated = DynamicOnly     │
                        │                                  │
                        ▼  synchronizeMutableCookies ◄──────┘
             re-render (store)/layout.tsx + current page
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
   Header cartCount              /carrito line list
   (cookie only, no DB)          resolveCartLines(prisma, cart)
                                        ▲
                                        │ same call
                                  /checkout summary
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/modules/cart/cart-lines.ts` | **Create** | `resolveCartLines(db, cart)` — the shared resolver. **Not in the proposal's table.** |
| `src/modules/cart/cart-lines.test.ts` | **Create** | Unit tests with a stubbed `db`: drops, clamping, subtotal, itemCount. |
| `src/app/(store)/carrito/page.tsx` | Create | Server Component: empty state, line list, notices, subtotal, link to `/checkout`. |
| `src/components/storefront/CartLineControls.tsx` | **Create** | Client island: stepper + Eliminar. **Not in the proposal's table.** |
| `src/app/(store)/carrito/page.test.tsx` | Create | Empty state, dropped-line notice, over-stock flag. |
| `src/modules/cart/cart-cookie.ts` | Modify | `updateCartQty` / `removeCartItem` actions, `refresh()` in mutating actions, `maxAge` 30d → 7d. |
| `src/app/(store)/layout.tsx` | **Modify** | Reads `getCart()`, passes `cartCount` to `Header`. **Not in the proposal's table.** |
| `src/components/storefront/Header.tsx` | Modify | Cart link + count, right-aligned on the wordmark row. |
| `src/app/(store)/checkout/page.tsx` | Modify | Uses `resolveCartLines`; redirects to `/carrito` when empty or when `dropped.length > 0`. |
| `src/components/storefront/CheckoutForm.tsx` | Modify | Read-only summary; consumes `body.variantIds`. |
| `src/app/api/checkout/route.ts` | Modify | One `clearCart()` call after line 209. |
| `src/components/storefront/SizeSelector.tsx` | Modify | **Scope corrected** — see DA-1: disable-at-cap, no new qty input. |
| `src/app/(store)/producto/[slug]/page.tsx` | **Modify** | Passes per-variant in-cart qty into `SizeSelector`. **Not in the proposal's table.** |
| `src/modules/cart/cart.ts`, `prisma/schema.prisma`, `src/lib/mercadopago.ts`, `src/modules/orders/order.service.ts` | Unchanged | Proposal is correct on all four. |
| `src/proxy.ts` | Unchanged | Matcher is `["/admin/:path*"]`; `/carrito` is unaffected. |

## Interfaces / Contracts

```ts
// src/modules/cart/cart-lines.ts  (server-only; no "use server")
export interface ResolvedCartLine {
  variantId: string;
  productSlug: string;      // link back to the PDP
  productName: string;
  size: string;
  label: string;            // `${productName} — Talle ${size}` — SINGLE source
                            // of the label used by /carrito, /checkout AND the
                            // 409 variantId→label lookup
  unitPrice: number;        // Number(variant.priceOverride ?? product.price)
  qty: number;              // as stored in the cookie, never clamped here
  available: number;        // getAvailableStock(variant) — live read
  maxSelectable: number;    // Math.max(0, available)
  exceedsStock: boolean;    // qty > available
  isUnavailable: boolean;   // available <= 0
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

export interface DroppedCartLine {
  variantId: string;
  reason: "variant_not_found";   // the only real case: Product has no
                                 // published flag; product delete cascades
}

export interface ResolvedCart {
  lines: ResolvedCartLine[];
  dropped: DroppedCartLine[];
  subtotal: number;           // sum(unitPrice * qty) over lines only
  itemCount: number;          // sum(qty) over lines only
  hasBlockingLines: boolean;  // any isUnavailable || exceedsStock
}

export async function resolveCartLines(
  db: Pick<PrismaClient, "variant">,
  cart: Cart,
): Promise<ResolvedCart>;
// One query: variant.findMany({ where:{ id:{ in: ids } },
//   include:{ product:{ include:{ images:{ orderBy:{position:"asc"}, take:1 } } } } })
// Availability reuses summarizeVariantAvailability / getAvailableStock —
// the onHand - held formula stays in exactly one place.
```

```ts
// src/modules/cart/cart-cookie.ts  ("use server" — every export is an action)
const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days (was 30)

export async function updateCartQty(variantId: string, qty: number): Promise<void> {
  await writeCart(updateQty(await getCart(), variantId, qty)); // qty<=0 → removeItem
  refresh();                                                   // from "next/cache"
}
export async function removeCartItem(variantId: string): Promise<void> {
  await writeCart(removeItem(await getCart(), variantId));
  refresh();
}
// addToCart() also gains refresh() — that is what moves the badge on PDP add.
// clearCart() does NOT (it runs from a Route Handler; refresh() throws E870).
```

```tsx
// src/components/storefront/CartLineControls.tsx  ("use client")
interface CartLineControlsProps {
  qty: number;
  max: number;          // line.maxSelectable
  label: string;        // for aria-labels: "Cantidad de {label}"
  onUpdateQty: (qty: number) => Promise<void>;  // bound action
  onRemove: () => Promise<void>;                // bound action
}

// Bound in the Server Component — the reason addOneToCart exists (arity),
// solved here with .bind() since arity differs per callback:
<CartLineControls
  qty={line.qty} max={line.maxSelectable} label={line.label}
  onUpdateQty={updateCartQty.bind(null, line.variantId)}
  onRemove={removeCartItem.bind(null, line.variantId)}
/>
```

```ts
// CheckoutForm.tsx — 409 mapping.
// Route returns: { error:"stock_unavailable", variantIds: string[], message: string }
// CheckoutForm already holds items[{ variantId, label }] — no new prop needed.
type SubmitState =
  | ...
  | { status: "error"; message: string; conflictedLabels?: string[] };

const ids = Array.isArray(body.variantIds)
  ? body.variantIds.filter((v: unknown): v is string => typeof v === "string")
  : [];
const conflictedLabels = items
  .filter((i) => ids.includes(i.variantId))
  .map((i) => i.label);
// conflictedLabels.length > 0 → render a <ul> of the named lines + a
// <Link href="/carrito">Ajustar el carrito</Link>.
// Empty → fall back to body.message verbatim. Never fabricate a name.
```

## DA-1 — Confirmed by owner

The proposal's Affected Areas lists `SizeSelector.tsx` as Modified for "Quantity cap against available stock", but nothing in Scope, Decisions, or Success Criteria asked for a quantity input on the PDP, and "Agregar al carrito" adds exactly 1 unit today. The owner reviewed this ambiguity directly and confirmed: **no quantity input on the PDP.**

**Decided:** no quantity input is added to the PDP. All quantity control lives in `/carrito`. The PDP cap is enforced as a *disable with a named reason*: `SizeSelector` gains `inCartQty?: Record<string, number>`, `canAddToCart` becomes `selected.isAvailable && (inCartQty[selected.id] ?? 0) < selected.available`, and at the cap the button reads **"Ya tenés el máximo disponible"** instead of silently no-op'ing on the 3rd click of a 2-stock variant. `producto/[slug]/page.tsx` supplies `inCartQty` from `getCart()`. This is why that page is a new Modified entry.

## Visual Design

Direction is pinned by the brief: extend the existing restrained system. No new dependency, no icon library (none installed), no shadow, no gradient, no radius, no new color token.

**`/carrito` — the receipt.** Hairline-ruled rows (`divide-y divide-ink/10`), each row: an `aspect-[1/1.5]` thumbnail in the same `border-ink/10 bg-surface-container` frame the PDP and `ProductCard` use — the item looks like the same object it did on the product page; then `font-serif text-[18px]` name over `text-label-caps uppercase tracking-widest text-on-surface-variant` size; then the stepper; then the line total right-aligned in `text-price-display tabular-nums`.

*Signature:* every line total and the subtotal share one right-hand price column, so the page reads top-to-bottom as a single ledger. That is the one deliberate move — it encodes what the page actually is (a running tally), rather than decorating it. Everything else stays quiet.

**Stepper.** Two 32px square hairline buttons flanking a `tabular-nums` count — the same `h-12 w-12 border border-ink` vocabulary as `SizeSelector`'s size buttons, scaled down. `−` disabled at 1 (removal is the named **Eliminar** action, per the owner's decision). `+` disabled at `maxSelectable`, with the reason named beside it, never a dead control.

**Header cart link.** A 20px hand-written 1px-stroke bag SVG (`stroke-ink`, `strokeWidth={1}`, matches the hairline language), with the count inline after it in `text-label-caps tracking-widest tabular-nums`. Nothing renders when the cart is empty. Rejected: a filled circular badge — that is the template answer, and a solid dot is the loudest object in a header built entirely from hairlines. Positioned `absolute right-margin-mobile md:right-gutter` on the wordmark row so the centered "Dominique" stays centered. `aria-label="Carrito, {n} artículos"`.

**Empty state.** `Tu carrito está vacío.` + `Ver la tienda` link — reuses `checkout/page.tsx`'s exact existing markup so the two pages cannot drift.

**Notices.** Reuse the codebase-wide `<p role="alert" className="font-sans text-body-md text-red-700">` convention (13 occurrences across admin + `CheckoutForm`) for the dropped-line and out-of-stock notices. No storefront-specific treatment: consistency across admin and storefront is worth more than tonal nuance, and red-on-paper is already this app's only error signal.

**Copy** (es-AR, active voice, names what happened): dropped line → `Quitamos un artículo que ya no está disponible.`; over-stock → `Solo quedan {n}. Ajustá la cantidad.`; zero-stock → `Sin stock. Eliminá este artículo para continuar.`

**Quality floor.** Stepper and Eliminar are real `<button>`s with visible focus; the stepper is keyboard-operable; the layout collapses to a stacked single column below `md`; no motion added, so reduced-motion is satisfied by construction.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `resolveCartLines` — dropped lines, `exceedsStock`, `isUnavailable`, subtotal, itemCount, `priceOverride` precedence | Vitest, stubbed `db.variant.findMany` (mirrors `product.service.test.ts`) |
| Unit | `cart.ts` `updateQty`/`removeItem` | Already covered; unchanged |
| Component | `CartLineControls` — `−` disabled at 1, `+` disabled at max, actions fire with the right args | RTL + `user-event` (mirrors `SizeSelector.test.tsx`) |
| Component | `CheckoutForm` 409 → named labels; unknown ids → falls back to `body.message` | RTL, mocked `fetch` (extends `CheckoutForm.test.tsx`) |
| Component | `SizeSelector` at-cap disable (DA-1) | RTL, `inCartQty` prop |
| Component | `Header` badge — hidden at 0, count at n | RTL, plain prop render |
| Integration | `/carrito` empty state, dropped-line notice, over-stock flag | Async Server Component render (mirrors `producto/[slug]/page.test.tsx`) |
| Integration | `POST /api/checkout` clears the cart on both 201 and 303, and never fails the order when the cookie write throws | Extends `route.test.ts` |
| E2E | Add from PDP → badge increments → `/carrito` edit → `/checkout` → order → cart empty | Playwright |

## Threat Matrix

No shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary — those rows are `N/A`.

| Row | Status | Behavior / RED test |
|---|---|---|
| Routing | **Applicable (low)** | `/carrito` is public and outside `proxy.ts`'s `["/admin/:path*"]` matcher. RED test: `/carrito` renders without a session. |
| Untrusted input → Server Action | **Applicable** | `updateCartQty` accepts a client-supplied `qty` and a `.bind()`-encoded `variantId`. `updateQty`'s existing `Number.isFinite(qty) || qty <= 0 → removeItem` guard absorbs `NaN`/`Infinity`/negatives/floats. RED tests: `qty = -1`, `NaN`, `1e9`, unknown `variantId` — each degrades, never throws, never writes a corrupt cookie. |
| Client-side stock cap bypass | **Applicable** | The cap is a courtesy layer. A forged `qty` beyond stock must still be rejected by `POST /api/checkout`'s `StockUnavailableError`. RED test: cookie hand-set past `available` → 409 with `variantIds`, no hold created. |
| Cookie tampering | Covered | `parseCart` already degrades to `[]`; `/carrito` renders the empty state. |

## Migration / Rollout

No migration. Shortening `maxAge` 30d → 7d does not invalidate existing cookies — the browser keeps the original expiry until the next write, at which point the shorter window applies. Rollout is additive and reverts per the proposal's separable plan.

## Open Questions — resolved

- [x] **DA-1**: owner confirmed no quantity input is added to the PDP (cap enforced as disable-at-max only).
- [x] Accepted cost in D2: reading the cart cookie in `(store)/layout.tsx` makes every storefront route dynamic (opts out of static generation for home/`categoria`/`producto`, which `/checkout` already was). Accepted — this is consistent with `stock.service.ts`'s existing "Real-Time-Accurate Stock View" intent (available stock is already meant to be exact on every read, not cached), so it is not a new tradeoff being introduced, just an existing one becoming uniform across the storefront.
