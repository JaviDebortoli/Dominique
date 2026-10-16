import { describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";

// Backs openspec/changes/carrito-completo/specs/cart-checkout/spec.md's
// "Cart Cookie Lifetime" scenario — the only cart-cookie.ts behavior that
// had zero runtime-passing coverage per sdd-verify's gate check. Mirrors
// carrito/page.test.tsx's next/headers mocking pattern.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const mockedCookies = vi.mocked(cookies);

function mockCookieStore() {
  const set = vi.fn();
  mockedCookies.mockResolvedValue({
    get: () => undefined,
    set,
  } as unknown as Awaited<ReturnType<typeof cookies>>);
  return { set };
}

function mockCookieStoreWith(cart: { variantId: string; qty: number }[]) {
  const set = vi.fn();
  mockedCookies.mockResolvedValue({
    get: () => ({ value: JSON.stringify(cart) }),
    set,
  } as unknown as Awaited<ReturnType<typeof cookies>>);
  return { set };
}

describe("cart-cookie: removeOneFromCart (undo of Agregado)", () => {
  it("subtracts only the last added unit when the variant has more than one", async () => {
    const { removeOneFromCart } = await import("./cart-cookie");
    const { set } = mockCookieStoreWith([
      { variantId: "variant-1", qty: 3 },
      { variantId: "variant-2", qty: 1 },
    ]);

    await removeOneFromCart("variant-1");

    expect(JSON.parse(set.mock.calls[0][1])).toEqual([
      { variantId: "variant-1", qty: 2 },
      { variantId: "variant-2", qty: 1 },
    ]);
  });

  it("removes the line when the variant had a single unit", async () => {
    const { removeOneFromCart } = await import("./cart-cookie");
    const { set } = mockCookieStoreWith([
      { variantId: "variant-1", qty: 1 },
      { variantId: "variant-2", qty: 2 },
    ]);

    await removeOneFromCart("variant-1");

    expect(JSON.parse(set.mock.calls[0][1])).toEqual([{ variantId: "variant-2", qty: 2 }]);
  });
});

describe("cart-cookie: cookie lifetime", () => {
  it("writes the cart cookie with a 7-day maxAge", async () => {
    const { addOneToCart } = await import("./cart-cookie");
    const { set } = mockCookieStore();

    await addOneToCart("variant-1");

    expect(set).toHaveBeenCalledWith(
      "dominique_cart",
      expect.any(String),
      expect.objectContaining({ maxAge: 60 * 60 * 24 * 7 }),
    );
  });
});
