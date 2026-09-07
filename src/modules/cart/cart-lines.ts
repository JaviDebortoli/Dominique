// Shared cart line resolver. Server-only — NOT "use server" (design.md D1):
// cart-cookie.ts is a Server Actions module, and every export of a "use
// server" file becomes a client-callable action endpoint. A resolver that
// takes an explicit `db: PrismaClient` argument cannot live there. This is
// the single place `/carrito` and `/checkout` both resolve cart lines
// against live product/stock data, so the two pages cannot drift into
// divergent line-rendering implementations (proposal.md's own Risk row).
//
// Backs specs/cart-checkout/spec.md:
//   - "Cart View" (product, size, qty, unit price, line total, subtotal)
//   - "Cart Quantity Editing" (available-stock clamp, exceedsStock flag)
//   - "Unresolvable Cart Line Notice" (dropped lines named, never silently
//     filtered)
//   - "Stock Re-Validation at Submission" (this module only reads/derives —
//     it never re-validates or blocks a submission itself)

import type { PrismaClient } from "@/generated/prisma/client";
import { getAvailableStock } from "@/modules/catalog/variant-availability";
import type { Cart } from "./cart";

export interface ResolvedCartLine {
  variantId: string;
  productSlug: string;
  productName: string;
  size: string;
  /** `${productName} — Talle ${size}` — the single source of the label used
   * by /carrito, /checkout, AND the 409 variantId→label lookup. */
  label: string;
  unitPrice: number;
  qty: number;
  available: number;
  maxSelectable: number;
  exceedsStock: boolean;
  isUnavailable: boolean;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

export interface DroppedCartLine {
  variantId: string;
  reason: "variant_not_found";
}

export interface ResolvedCart {
  lines: ResolvedCartLine[];
  dropped: DroppedCartLine[];
  subtotal: number;
  itemCount: number;
  hasBlockingLines: boolean;
}

export async function resolveCartLines(
  db: Pick<PrismaClient, "variant">,
  cart: Cart,
): Promise<ResolvedCart> {
  if (cart.length === 0) {
    return { lines: [], dropped: [], subtotal: 0, itemCount: 0, hasBlockingLines: false };
  }

  const variantIds = cart.map((item) => item.variantId);
  const variants = await db.variant.findMany({
    where: { id: { in: variantIds } },
    include: {
      product: {
        include: {
          images: { orderBy: { position: "asc" }, take: 1 },
        },
      },
    },
  });
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));

  const lines: ResolvedCartLine[] = [];
  const dropped: DroppedCartLine[] = [];

  for (const item of cart) {
    const variant = variantById.get(item.variantId);
    if (!variant) {
      dropped.push({ variantId: item.variantId, reason: "variant_not_found" });
      continue;
    }

    const available = getAvailableStock(variant);
    const thumbnail = variant.product.images[0] ?? null;

    lines.push({
      variantId: variant.id,
      productSlug: variant.product.slug,
      productName: variant.product.name,
      size: variant.size,
      label: `${variant.product.name} — Talle ${variant.size}`,
      unitPrice: Number(variant.priceOverride ?? variant.product.price),
      qty: item.qty,
      available,
      maxSelectable: Math.max(0, available),
      exceedsStock: item.qty > available,
      isUnavailable: available <= 0,
      thumbnailUrl: thumbnail?.url ?? null,
      thumbnailAlt: thumbnail?.altText ?? null,
    });
  }

  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  const itemCount = lines.reduce((sum, line) => sum + line.qty, 0);
  const hasBlockingLines = lines.some((line) => line.isUnavailable || line.exceedsStock);

  return { lines, dropped, subtotal, itemCount, hasBlockingLines };
}
