import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
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
// `next/headers`'s cookies() and `next/navigation`'s redirect() only
// resolve/behave correctly inside a real Next.js request/render — both are
// mocked here (cookies() mirrors carrito/page.test.tsx's pattern; redirect()
// is mocked to throw, mirroring its real behavior of never returning so a
// caller cannot accidentally keep rendering past it).
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
const mockedCookies = vi.mocked(cookies);
const mockedRedirect = vi.mocked(redirect);

function mockCartCookie(items: { variantId: string; qty: number }[] | null) {
  mockedCookies.mockResolvedValue({
    get: () => (items ? { value: JSON.stringify(items) } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

describe("CheckoutPage (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
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

    await expect(CheckoutPage()).rejects.toThrow("NEXT_REDIRECT");
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

    await expect(CheckoutPage()).rejects.toThrow("NEXT_REDIRECT");
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

    render(await CheckoutPage());

    expect(screen.getByLabelText(/nombre/i)).toBeInTheDocument();
    expect(screen.getByText(/talle m/i, { exact: false })).toBeInTheDocument();
    expect(mockedRedirect).not.toHaveBeenCalled();
  });
});
