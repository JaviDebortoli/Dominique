import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCart } from "@/modules/cart/cart-cookie";
import { resolveCartLines } from "@/modules/cart/cart-lines";
import { CheckoutForm, type CheckoutFormItem } from "@/components/storefront/CheckoutForm";

// Checkout page — payment-only, per design.md's /carrito ↔ /checkout split.
// Backs specs/cart-checkout/spec.md:
//   - "Guest-Only Checkout"
//   - "No Shipping/Address Collection"
//   - "Empty Cart State" ("Checkout reached with an empty cart" redirects to
//     /carrito instead of rendering the payment form)
//   - "Unresolvable Cart Line Notice" ("Deleted product line detected on the
//     checkout page" redirects to /carrito carrying that notice, rather than
//     silently changing the payment total)
// tasks.md 3.3, design.md D1 — uses the same resolveCartLines(prisma, cart)
// resolver as /carrito (not a duplicated inline Prisma query), so the two
// pages cannot drift into divergent line-rendering implementations. Stock
// re-validation happens again on submit at the API layer — this page's line
// list is for display only and is never trusted as the source of truth for
// pricing or availability.
//
// odd/tasks/comprar-ahora.md T2 — a `?variante=<id>` search param switches
// this page to buy-now mode: it resolves a single qty-1 line for THAT
// variant via the same resolveCartLines(prisma, ...) resolver (passing a
// one-line synthetic cart instead of the cookie's), and the cart cookie is
// never read at all in this mode — the owner's confirmed requirement that a
// buy-now purchase must leave the shopper's actual cart untouched. Same
// redirect rule as the cart flow: no line, a dropped line, or a blocking
// line (out of stock / exceeds stock) all bounce to /carrito rather than
// rendering a payment form for something that can't actually be bought.
interface CheckoutPageProps {
  searchParams: Promise<{ variante?: string }>;
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const { variante } = await searchParams;
  const buyNow = typeof variante === "string" && variante.length > 0;

  const resolved = buyNow
    ? await resolveCartLines(prisma, [{ variantId: variante, qty: 1 }])
    : await resolveCartLines(prisma, await getCart());

  // Buy-now additionally bounces on hasBlockingLines (out of stock /
  // exceeds stock) — a single-line synthetic cart with no quantity stepper
  // to fix it in place, unlike /carrito. The pre-existing cart-mode redirect
  // rule stays exactly as it was ("Cart mode unchanged" — comprar-ahora.md
  // T2): /carrito is the place a blocked cart line gets resolved.
  const blocked = buyNow
    ? resolved.lines.length === 0 || resolved.dropped.length > 0 || resolved.hasBlockingLines
    : resolved.lines.length === 0 || resolved.dropped.length > 0;

  if (blocked) {
    redirect("/carrito");
  }

  const items: CheckoutFormItem[] = resolved.lines.map((line) => ({
    variantId: line.variantId,
    label: line.label,
    qty: line.qty,
    unitPrice: line.unitPrice,
  }));

  return (
    <section className="mx-auto max-w-container px-margin-mobile py-section md:px-gutter">
      <h1 className="mb-6 font-serif text-headline-lg-mobile text-ink md:text-headline-lg">
        Finalizar compra
      </h1>
      <CheckoutForm items={items} buyNow={buyNow} />
    </section>
  );
}
