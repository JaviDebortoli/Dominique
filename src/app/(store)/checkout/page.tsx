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
export default async function CheckoutPage() {
  const cart = await getCart();
  const resolved = await resolveCartLines(prisma, cart);

  if (resolved.lines.length === 0 || resolved.dropped.length > 0) {
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
      <CheckoutForm items={items} />
    </section>
  );
}
