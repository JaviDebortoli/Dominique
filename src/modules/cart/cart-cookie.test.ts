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
