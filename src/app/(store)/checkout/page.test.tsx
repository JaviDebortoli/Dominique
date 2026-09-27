import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import { hold } from "@/modules/inventory/stock.service";
import CheckoutPage from "./page";

// Backs specs/cart-checkout/spec.md:
//   - "Empty Cart State" ("Checkout reached with an empty cart" scenario)
//   - "Unresolvable Cart Line Notice" ("Deleted product line detected on the
//     checkout page" scenario)
// tasks.md 3.3, design.md D1 — checkout/page.tsx now uses the same
// resolveCartLines(prisma, cart) resolver as /carrito instead of its own
// inline Prisma query, and redirects to /carrito (rather than silently
// shrinking the total or rendering with a stale line) whenever the cart is
// empty or resolveCartLines reports a dropped line.
//
// odd/tasks/comprar-ahora.md T2 — a `?variante=<id>` search param resolves
// a single qty-1 line for THAT variant instead of the cart cookie (buy-now).
// `mockSearchParams()` defaults to `{}` (the existing cart-only flow) so
// every pre-existing test below only had to add the explicit arg, not
// change behavior.
//
// `next/headers`'s cookies() and `next/navigation`'s redirect() only
// resolve/behave correctly inside a real Next.js request/render — both are
// mocked here (cookies() mirrors carrito/page.test.tsx's pattern; redirect()
// is mocked to throw, mirroring its real behavior of never returning so a
// caller cannot accidentally keep rendering past it).
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
const mockedCookies = vi.mocked(cookies);
const mockedRedirect = vi.mocked(redirect);

function searchParamsOf(variante?: string) {
  return Promise.resolve(variante === undefined ? {} : { variante });
}

function mockCartCookie(items: { variantId: string; qty: number }[] | null) {
  mockedCookies.mockResolvedValue({
    get: () => (items ? { value: JSON.stringify(items) } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

describe("CheckoutPage (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    // The buy-now out-of-stock test below calls hold(), which writes a
    // StockMovement row — must be cleared before the product/variant it
    // references, same ordering as route.test.ts's cleanup.
    await prisma.stockMovement.deleteMany({
      where: { variant: { productId: { in: createdProductIds } } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makeCategory(name: string) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name, slug: `${name}-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    return category;
  }

  afterEach(() => {
    mockedRedirect.mockReset();
  });

  it("redirects to /carrito when the cart is empty", async () => {
    mockCartCookie(null);
    mockedRedirect.mockImplementationOnce(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(CheckoutPage({ searchParams: searchParamsOf() })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mockedRedirect).toHaveBeenCalledWith("/carrito");
  });

  it("redirects to /carrito when a cart line's product no longer resolves, instead of silently shrinking the total", async () => {
    const category = await makeCategory("checkout-dropped");
    const suffix = randomUUID();

    const product = await createProduct(prisma, {
      name: `Producto Borrado Checkout ${suffix}`,
      slug: `producto-borrado-checkout-${suffix}`,
      price: 15000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Negro", sku: `CHK-DROP-${suffix}`, onHand: 3 }],
    });
    const droppedVariantId = product.variants[0].id;
    await prisma.product.delete({ where: { id: product.id } });

    mockCartCookie([{ variantId: droppedVariantId, qty: 1 }]);
    mockedRedirect.mockImplementationOnce(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(CheckoutPage({ searchParams: searchParamsOf() })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mockedRedirect).toHaveBeenCalledWith("/carrito");
  });

  it("renders the payment form with resolved line items when the cart is valid", async () => {
    const category = await makeCategory("checkout-valid");
    const suffix = randomUUID();

    const product = await createProduct(prisma, {
      name: `Vestido Checkout ${suffix}`,
      slug: `vestido-checkout-${suffix}`,
      price: 25000,
      categoryId: category.id,
      variants: [{ size: "M", color: "Negro", sku: `CHK-OK-${suffix}`, onHand: 5 }],
    });
    createdProductIds.push(product.id);

    mockCartCookie([{ variantId: product.variants[0].id, qty: 2 }]);

    render(await CheckoutPage({ searchParams: searchParamsOf() }));

    expect(screen.getByLabelText(/nombre/i)).toBeInTheDocument();
    expect(screen.getByText(/talle m/i, { exact: false })).toBeInTheDocument();
    expect(mockedRedirect).not.toHaveBeenCalled();
  });

  // odd/tasks/comprar-ahora.md T2 — `?variante=<id>` builds a single qty-1
  // line for that variant, ignoring the cart cookie entirely (the owner's
  // buy-now requirement: the shopper's actual cart must stay untouched).
  describe("Buy-now (?variante=<id>)", () => {
    it("resolves exactly that variant at qty 1, ignoring whatever is in the cart cookie", async () => {
      const category = await makeCategory("checkout-buy-now");
      const suffix = randomUUID();

      const cartProduct = await createProduct(prisma, {
        name: `Producto En Carrito ${suffix}`,
        slug: `producto-en-carrito-${suffix}`,
        price: 10000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Negro", sku: `CART-${suffix}`, onHand: 5 }],
      });
      createdProductIds.push(cartProduct.id);

      const buyNowProduct = await createProduct(prisma, {
        name: `Producto Comprar Ahora ${suffix}`,
        slug: `producto-comprar-ahora-${suffix}`,
        price: 20000,
        categoryId: category.id,
        variants: [{ size: "M", color: "Negro", sku: `BUYNOW-${suffix}`, onHand: 5 }],
      });
      createdProductIds.push(buyNowProduct.id);

      // A different item sits in the cart cookie — it must never appear.
      mockCartCookie([{ variantId: cartProduct.variants[0].id, qty: 3 }]);

      render(
        await CheckoutPage({
          searchParams: searchParamsOf(buyNowProduct.variants[0].id),
        }),
      );

      expect(screen.getByText(/producto comprar ahora/i, { exact: false })).toBeInTheDocument();
      expect(screen.queryByText(/producto en carrito/i)).not.toBeInTheDocument();
      expect(mockedRedirect).not.toHaveBeenCalled();
    });

    it("redirects to /carrito when the variante id does not resolve to a real variant, ignoring a non-empty cart cookie", async () => {
      const category = await makeCategory("checkout-buy-now-unresolvable");
      const suffix = randomUUID();
      const cartProduct = await createProduct(prisma, {
        name: `Producto Carrito Ok ${suffix}`,
        slug: `producto-carrito-ok-${suffix}`,
        price: 9000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Negro", sku: `OKCART-${suffix}`, onHand: 5 }],
      });
      createdProductIds.push(cartProduct.id);

      // A perfectly valid cart is present — proves the redirect comes from
      // the unresolvable `variante`, not from an incidentally empty cart.
      mockCartCookie([{ variantId: cartProduct.variants[0].id, qty: 1 }]);
      mockedRedirect.mockImplementationOnce(() => {
        throw new Error("NEXT_REDIRECT");
      });

      await expect(
        CheckoutPage({ searchParams: searchParamsOf("variant-que-no-existe") }),
      ).rejects.toThrow("NEXT_REDIRECT");
      expect(mockedRedirect).toHaveBeenCalledWith("/carrito");
    });

    it("redirects to /carrito when the variante is out of stock", async () => {
      const category = await makeCategory("checkout-buy-now-sin-stock");
      const suffix = randomUUID();

      const product = await createProduct(prisma, {
        name: `Producto Sin Stock ${suffix}`,
        slug: `producto-sin-stock-${suffix}`,
        price: 12000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Negro", sku: `SINSTOCK-${suffix}`, onHand: 1 }],
      });
      createdProductIds.push(product.id);
      // Hold the single unit so available stock reaches 0.
      await hold(prisma, { variantId: product.variants[0].id, qty: 1 });

      const cartProduct = await createProduct(prisma, {
        name: `Producto Carrito Ok Dos ${suffix}`,
        slug: `producto-carrito-ok-dos-${suffix}`,
        price: 9000,
        categoryId: category.id,
        variants: [{ size: "U", color: "Negro", sku: `OKCART2-${suffix}`, onHand: 5 }],
      });
      createdProductIds.push(cartProduct.id);
      // A perfectly valid cart is present — proves the redirect comes from
      // the out-of-stock `variante`, not from an incidentally empty cart.
      mockCartCookie([{ variantId: cartProduct.variants[0].id, qty: 1 }]);
      mockedRedirect.mockImplementationOnce(() => {
        throw new Error("NEXT_REDIRECT");
      });

      await expect(
        CheckoutPage({ searchParams: searchParamsOf(product.variants[0].id) }),
      ).rejects.toThrow("NEXT_REDIRECT");
      expect(mockedRedirect).toHaveBeenCalledWith("/carrito");
    });
  });
});
