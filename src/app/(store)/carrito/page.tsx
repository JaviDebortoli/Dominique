import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCart } from "@/modules/cart/cart-cookie";
import { resolveCartLines } from "@/modules/cart/cart-lines";
import { formatPriceARS } from "@/lib/format-price";

// Cart page. Backs specs/cart-checkout/spec.md:
//   - "Cart View" (line list + subtotal)
//   - "Empty Cart State"
//   - "Unresolvable Cart Line Notice" (dropped lines named, never a silent
//     disappearance or a silently smaller total)
//   - "Cart Quantity Editing" (idle-cart over-stock clamp/flag, zero-stock
//     "unavailable" flag — the interactive stepper + explicit "Eliminar"
//     action is CartLineControls, tasks.md 1.4)
//
// design.md D1: resolveCartLines is the single shared resolver used by both
// /carrito and /checkout, so the two pages cannot drift into divergent
// line-rendering implementations. design.md D5: a Server Component cannot
// self-heal a dropped cookie line mid-render (cookies are not mutable
// during render), so the notice persists until the shopper removes that
// line via the explicit Eliminar action.
export default async function CartPage() {
  const cart = await getCart();
  const resolved = await resolveCartLines(prisma, cart);

  if (resolved.lines.length === 0) {
    return (
      <section className="mx-auto max-w-container px-margin-mobile py-section md:px-gutter">
        {resolved.dropped.length > 0 ? (
          <p role="alert" className="mb-6 font-sans text-body-md text-red-700">
            Quitamos un artículo que ya no está disponible.
          </p>
        ) : null}
        <p className="font-sans text-body-md text-ink">
          Tu carrito está vacío.{" "}
          <Link href="/" className="underline">
            Ver la tienda
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-container px-margin-mobile py-section md:px-gutter">
      <h1 className="mb-6 font-serif text-headline-lg-mobile text-ink md:text-headline-lg">
        Tu carrito
      </h1>

      {resolved.dropped.length > 0 ? (
        <p role="alert" className="mb-6 font-sans text-body-md text-red-700">
          Quitamos un artículo que ya no está disponible.
        </p>
      ) : null}

      <ul className="divide-y divide-ink/10">
        {resolved.lines.map((line) => (
          <li key={line.variantId} className="flex gap-4 py-4">
            <div className="aspect-[1/1.5] w-20 shrink-0 overflow-hidden border border-ink/10 bg-surface-container">
              {line.thumbnailUrl ? (
                // Admin-uploaded local files (design.md D8), not a remote domain.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={line.thumbnailUrl}
                  alt={line.thumbnailAlt ?? line.productName}
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Link href={`/producto/${line.productSlug}`} className="font-serif text-[18px] text-ink">
                {line.productName}
              </Link>
              <p className="font-sans text-label-caps uppercase tracking-widest text-on-surface-variant">
                Talle {line.size}
              </p>
              {line.isUnavailable ? (
                <p role="alert" className="font-sans text-body-md text-red-700">
                  Sin stock. Eliminá este artículo para continuar.
                </p>
              ) : line.exceedsStock ? (
                <p role="alert" className="font-sans text-body-md text-red-700">
                  Solo quedan {line.available}. Ajustá la cantidad.
                </p>
              ) : null}
            </div>
            <p className="font-sans text-price-display tabular-nums text-ink">
              {formatPriceARS(line.unitPrice * line.qty)}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex justify-between border-t border-ink/10 pt-4 font-sans text-price-display tabular-nums text-ink">
        <span>Subtotal</span>
        <span>{formatPriceARS(resolved.subtotal)}</span>
      </div>

      <Link
        href="/checkout"
        className="mt-6 inline-block bg-nude px-8 py-3 font-sans text-label-caps uppercase tracking-widest text-ink hover:opacity-90"
      >
        Ir a pagar
      </Link>
    </section>
  );
}
