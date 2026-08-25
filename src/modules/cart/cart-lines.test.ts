import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { resolveCartLines } from "./cart-lines";
import type { Cart } from "./cart";

// Backs openspec/changes/carrito-completo/design.md's D1 ("shared line
// resolution lives in cart-lines.ts, not cart-cookie.ts") and its Interfaces
// section (ResolvedCartLine/DroppedCartLine/ResolvedCart). Stubbed
// `db.variant.findMany` — this module is a pure-ish resolver over whatever
// Prisma returns, so no real Postgres is needed to prove its branching
// (dropped lines, exceedsStock, isUnavailable, subtotal, itemCount,
// priceOverride precedence).
//
// Shape mirrors design.md's one query:
//   variant.findMany({ where: { id: { in: ids } },
//     include: { product: { include: { images: { orderBy: {position:"asc"}, take: 1 } } } } })
function makeVariant(overrides: {
  id: string;
  size?: string;
  priceOverride?: number | null;
  onHand: number;
  held: number;
  productId?: string;
  productName?: string;
  productSlug?: string;
  productPrice?: number;
  images?: { url: string; altText: string | null }[];
}) {
  return {
    id: overrides.id,
    productId: overrides.productId ?? "product-1",
    size: overrides.size ?? "M",
    color: "Negro",
    sku: `SKU-${overrides.id}`,
    priceOverride: overrides.priceOverride ?? null,
    onHand: overrides.onHand,
    held: overrides.held,
    createdAt: new Date(),
    updatedAt: new Date(),
    product: {
      id: overrides.productId ?? "product-1",
      name: overrides.productName ?? "Vestido Lino",
      slug: overrides.productSlug ?? "vestido-lino",
      description: null,
      price: overrides.productPrice ?? 45000,
      categoryId: "category-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      images: overrides.images ?? [],
    },
  };
}

function stubDb(variants: ReturnType<typeof makeVariant>[]): Pick<PrismaClient, "variant"> {
  return {
    variant: { findMany: vi.fn().mockResolvedValue(variants) },
  } as unknown as Pick<PrismaClient, "variant">;
}

describe("resolveCartLines", () => {
  it("resolves a line with product/size/label, unit price from product.price, and computes subtotal + itemCount", async () => {
    const cart: Cart = [{ variantId: "v-1", qty: 2 }];
    const db = stubDb([
      makeVariant({ id: "v-1", size: "M", onHand: 5, held: 0, productPrice: 45000 }),
    ]);

    const result = await resolveCartLines(db, cart);

    expect(result.dropped).toEqual([]);
    expect(result.lines).toHaveLength(1);
    const [line] = result.lines;
    expect(line.variantId).toBe("v-1");
    expect(line.productName).toBe("Vestido Lino");
    expect(line.productSlug).toBe("vestido-lino");
    expect(line.size).toBe("M");
    expect(line.label).toBe("Vestido Lino — Talle M");
    expect(line.unitPrice).toBe(45000);
    expect(line.qty).toBe(2);
    expect(result.subtotal).toBe(90000);
    expect(result.itemCount).toBe(2);
    expect(result.hasBlockingLines).toBe(false);
  });

  it("uses priceOverride instead of product.price when present", async () => {
    const cart: Cart = [{ variantId: "v-1", qty: 1 }];
    const db = stubDb([
      makeVariant({
        id: "v-1",
        onHand: 5,
        held: 0,
        productPrice: 45000,
        priceOverride: 39900,
      }),
    ]);

    const result = await resolveCartLines(db, cart);

    expect(result.lines[0].unitPrice).toBe(39900);
    expect(result.subtotal).toBe(39900);
  });

  it("drops a line whose variant no longer resolves, with reason variant_not_found, and excludes it from subtotal/itemCount", async () => {
    const cart: Cart = [
      { variantId: "v-1", qty: 1 },
      { variantId: "v-missing", qty: 3 },
    ];
    const db = stubDb([makeVariant({ id: "v-1", onHand: 5, held: 0, productPrice: 10000 })]);

    const result = await resolveCartLines(db, cart);

    expect(result.dropped).toEqual([{ variantId: "v-missing", reason: "variant_not_found" }]);
    expect(result.lines).toHaveLength(1);
    expect(result.subtotal).toBe(10000);
    expect(result.itemCount).toBe(1);
  });

  it("flags exceedsStock when cart qty exceeds available stock (onHand - held) and clamps maxSelectable", async () => {
    const cart: Cart = [{ variantId: "v-1", qty: 3 }];
    const db = stubDb([makeVariant({ id: "v-1", onHand: 2, held: 1, productPrice: 10000 })]);

    const result = await resolveCartLines(db, cart);

    const [line] = result.lines;
    expect(line.available).toBe(1);
    expect(line.maxSelectable).toBe(1);
    expect(line.exceedsStock).toBe(true);
    expect(line.isUnavailable).toBe(false);
    expect(result.hasBlockingLines).toBe(true);
  });

  it("flags isUnavailable when available stock is 0 or less, clamping maxSelectable to 0", async () => {
    const cart: Cart = [{ variantId: "v-1", qty: 1 }];
    const db = stubDb([makeVariant({ id: "v-1", onHand: 2, held: 2, productPrice: 10000 })]);

    const result = await resolveCartLines(db, cart);

    const [line] = result.lines;
    expect(line.available).toBe(0);
    expect(line.maxSelectable).toBe(0);
    expect(line.isUnavailable).toBe(true);
    expect(result.hasBlockingLines).toBe(true);
  });

  it("does not flag a line whose quantity is within available stock", async () => {
    const cart: Cart = [{ variantId: "v-1", qty: 2 }];
    const db = stubDb([makeVariant({ id: "v-1", onHand: 5, held: 0, productPrice: 10000 })]);

    const result = await resolveCartLines(db, cart);

    const [line] = result.lines;
    expect(line.exceedsStock).toBe(false);
    expect(line.isUnavailable).toBe(false);
    expect(result.hasBlockingLines).toBe(false);
  });

  it("carries the product's first image as thumbnailUrl/thumbnailAlt, falling back to null when there are none", async () => {
    const cart: Cart = [
      { variantId: "v-1", qty: 1 },
      { variantId: "v-2", qty: 1 },
    ];
    const db = stubDb([
      makeVariant({
        id: "v-1",
        onHand: 5,
        held: 0,
        productPrice: 10000,
        images: [{ url: "/uploads/img.jpg", altText: "Vestido en percha" }],
      }),
      makeVariant({
        id: "v-2",
        onHand: 5,
        held: 0,
        productPrice: 10000,
        productId: "product-2",
        productSlug: "vestido-otro",
        productName: "Vestido Otro",
        images: [],
      }),
    ]);

    const result = await resolveCartLines(db, cart);

    const withImage = result.lines.find((line) => line.variantId === "v-1")!;
    const withoutImage = result.lines.find((line) => line.variantId === "v-2")!;
    expect(withImage.thumbnailUrl).toBe("/uploads/img.jpg");
    expect(withImage.thumbnailAlt).toBe("Vestido en percha");
    expect(withoutImage.thumbnailUrl).toBeNull();
    expect(withoutImage.thumbnailAlt).toBeNull();
  });

  it("returns an empty result for an empty cart without querying variants unnecessarily", async () => {
    const db = stubDb([]);

    const result = await resolveCartLines(db, []);

    expect(result.lines).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.subtotal).toBe(0);
    expect(result.itemCount).toBe(0);
    expect(result.hasBlockingLines).toBe(false);
  });
});
