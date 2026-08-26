import { describe, expect, it } from "vitest";
import { addItem, parseCart, removeItem, serializeCart, updateQty } from "./cart";

// Backs specs/cart-checkout/spec.md "Cart Holds Selected Variants":
//   GIVEN a customer selects size M, color Negro, quantity 1
//   WHEN they add it to the cart
//   THEN the cart SHALL show that exact variant with quantity 1
//
// Pure functions only — no DB/cookies here. The cart is a plain array of
// {variantId, qty}. Persistence (a cookie, per design.md's silence on cart
// storage — see src/modules/cart/cart-cookie.ts) is a thin wrapper around
// these functions, tested separately/manually since it depends on Next.js
// request-scoped cookies().
describe("cart.ts (pure)", () => {
  describe("addItem — Cart Holds Selected Variants", () => {
    it("adds the exact variant with the selected quantity to an empty cart", () => {
      const cart = addItem([], "variant-m-negro", 1);

      expect(cart).toEqual([{ variantId: "variant-m-negro", qty: 1 }]);
    });

    it("triangulation: adding a different variant/qty keeps both lines distinct", () => {
      const cart = addItem(addItem([], "variant-m-negro", 1), "variant-s-blanco", 3);

      expect(cart).toEqual([
        { variantId: "variant-m-negro", qty: 1 },
        { variantId: "variant-s-blanco", qty: 3 },
      ]);
    });

    it("adding the same variant again increments qty instead of duplicating the line", () => {
      const cart = addItem(addItem([], "variant-m-negro", 1), "variant-m-negro", 2);

      expect(cart).toEqual([{ variantId: "variant-m-negro", qty: 3 }]);
    });

    it("ignores a non-positive quantity", () => {
      expect(addItem([], "variant-m-negro", 0)).toEqual([]);
      expect(addItem([], "variant-m-negro", -1)).toEqual([]);
    });
  });

  describe("updateQty", () => {
    it("sets the exact quantity for the matching line", () => {
      const cart = updateQty([{ variantId: "v1", qty: 1 }], "v1", 5);

      expect(cart).toEqual([{ variantId: "v1", qty: 5 }]);
    });

    it("removes the line when the quantity is set to 0", () => {
      const cart = updateQty([{ variantId: "v1", qty: 1 }], "v1", 0);

      expect(cart).toEqual([]);
    });
  });

  describe("removeItem", () => {
    it("removes only the matching variant line", () => {
      const cart = removeItem(
        [
          { variantId: "v1", qty: 1 },
          { variantId: "v2", qty: 2 },
        ],
        "v1",
      );

      expect(cart).toEqual([{ variantId: "v2", qty: 2 }]);
    });
  });

  // openspec/changes/carrito-completo design.md Threat Matrix — "Untrusted
  // input → Server Action": updateCartQty/addOneToCart pass a client-
  // supplied `qty` straight into these pure functions. RED tests per
  // tasks.md 4.1: NaN, negative, an absurdly large value (1e9), and a
  // non-integer must all degrade safely (never throw, never corrupt other
  // lines) — confirming addItem/updateQty's existing
  // `Number.isFinite(qty) && qty > 0` guard already absorbs them, rather
  // than introducing new production code.
  describe("Threat Matrix: untrusted qty values (design.md Threat Matrix, tasks.md 4.1)", () => {
    it("addItem ignores NaN and Infinity instead of throwing or adding a corrupt line", () => {
      expect(addItem([], "variant-m-negro", NaN)).toEqual([]);
      expect(addItem([], "variant-m-negro", Infinity)).toEqual([]);
    });

    it("updateQty degrades to removeItem for NaN — never sets a NaN quantity", () => {
      const cart = updateQty([{ variantId: "v1", qty: 2 }], "v1", NaN);

      expect(cart).toEqual([]);
    });

    it("updateQty degrades to removeItem for a negative quantity", () => {
      const cart = updateQty([{ variantId: "v1", qty: 2 }], "v1", -1);

      expect(cart).toEqual([]);
    });

    it("updateQty accepts an absurdly large quantity (1e9) without throwing — clamping against real stock is resolveCartLines' job, not the cart's", () => {
      const cart = updateQty([{ variantId: "v1", qty: 1 }], "v1", 1e9);

      expect(cart).toEqual([{ variantId: "v1", qty: 1e9 }]);
    });

    it("updateQty accepts a non-integer quantity without throwing or corrupting the other line", () => {
      const cart = updateQty(
        [
          { variantId: "v1", qty: 1 },
          { variantId: "v2", qty: 3 },
        ],
        "v1",
        1.5,
      );

      expect(cart).toEqual([
        { variantId: "v1", qty: 1.5 },
        { variantId: "v2", qty: 3 },
      ]);
    });

    it("updateQty on an unknown variantId leaves the cart unchanged rather than throwing or inserting a phantom line", () => {
      const cart = [{ variantId: "v1", qty: 1 }];

      expect(updateQty(cart, "variant-que-no-existe", 5)).toEqual(cart);
    });
  });

  describe("serializeCart / parseCart round-trip", () => {
    it("round-trips a non-empty cart through JSON", () => {
      const cart = [
        { variantId: "v1", qty: 2 },
        { variantId: "v2", qty: 1 },
      ];

      expect(parseCart(serializeCart(cart))).toEqual(cart);
    });

    it("parses missing/invalid/malformed input as an empty cart rather than throwing", () => {
      expect(parseCart(undefined)).toEqual([]);
      expect(parseCart(null)).toEqual([]);
      expect(parseCart("")).toEqual([]);
      expect(parseCart("not json")).toEqual([]);
      expect(parseCart(JSON.stringify({ not: "an array" }))).toEqual([]);
      expect(parseCart(JSON.stringify([{ variantId: "v1", qty: -1 }]))).toEqual([]);
      expect(parseCart(JSON.stringify([{ variantId: 42, qty: 1 }]))).toEqual([]);
    });
  });
});
