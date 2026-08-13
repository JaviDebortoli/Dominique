import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCart } from "@/modules/cart/cart-cookie";
import { CheckoutForm, type CheckoutFormItem } from "@/components/storefront/CheckoutForm";

// Checkout page. Backs specs/cart-checkout/spec.md:
//   - "Guest-Only Checkout"
//   - "No Shipping/Address Collection"
// tasks.md 4.4. Reads the cart cookie server-side (src/modules/cart/*),
// resolves each line's current product/price for display, and renders the
// contact-only form (CheckoutForm). Stock re-validation happens again on
// submit at the API layer (tasks.md 4.5) — this page's line list is for
// display only and is never trusted as the source of truth for pricing or
// availability.
export default async function CheckoutPage() {
  const cart = await getCart();

  if (cart.length === 0) {
    return (
      <section className="mx-auto max-w-container px-margin-mobile py-section md:px-gutter">
        <p className="font-sans text-body-md text-ink">
          Tu carrito está vacío.{" "}
          <Link href="/" className="underline">
            Volver a la tienda
          </Link>
          .
        </p>
      </section>
    );
  }

  const variants = await prisma.variant.findMany({
    where: { id: { in: cart.map((item) => item.variantId) } },
    include: { product: true },
  });
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));

  const items: CheckoutFormItem[] = cart
    .map((line) => {
      const variant = variantById.get(line.variantId);
      if (!variant) return null;
      const unitPrice = Number(variant.priceOverride ?? variant.product.price);
      return {
        variantId: line.variantId,
        label: `${variant.product.name} — Talle ${variant.size}`,
        qty: line.qty,
        unitPrice,
      };
    })
    .filter((item): item is CheckoutFormItem => item !== null);

  return (
    <section className="mx-auto max-w-container px-margin-mobile py-section md:px-gutter">
      <h1 className="mb-6 font-serif text-headline-lg-mobile text-ink md:text-headline-lg">
        Finalizar compra
      </h1>
      <CheckoutForm items={items} />
    </section>
  );
}
