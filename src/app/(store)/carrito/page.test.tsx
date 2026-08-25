import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import CartPage from "./page";

// Backs specs/cart-checkout/spec.md:
//   - "Cart View" (line list + subtotal)
//   - "Empty Cart State"
//   - "Unresolvable Cart Line Notice" (dropped lines named, never silent)
//   - "Cart Quantity Editing" (idle-cart over-stock clamp/flag, zero-stock
//     "unavailable" flag)
// Mirrors producto/[slug]/page.test.tsx's integration shape (real Postgres,
// no mocked Prisma — design.md's Testing Strategy). `next/headers`'s
// `cookies()` is mocked because it only resolves inside a real Next.js
// request/render, which this direct async-component-call harness is not;
// resolveCartLines and cart.ts's pure functions carry the actual branching
// logic under test elsewhere (cart-lines.test.ts, cart.test.ts).
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
const mockedCookies = vi.mocked(cookies);

function mockCartCookie(items: { variantId: string; qty: number }[] | null) {
  mockedCookies.mockResolvedValue({
    get: () => (items ? { value: JSON.stringify(items) } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

describe("CartPage (integration, real Postgres)", () => {
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

  it("shows an empty-cart message with a link to keep shopping when the cart has no lines", async () => {
    mockCartCookie(null);

    render(await CartPage());

    expect(screen.getByText(/tu carrito está vacío/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /ver la tienda/i });
    expect(link).toHaveAttribute("href", "/");
  });

  it("lists every line with product, size, and line total, and shows a subtotal equal to the sum of line totals", async () => {
    const category = await makeCategory("carrito-listado");
    const suffix = randomUUID();

    const product = await createProduct(prisma, {
      name: `Vestido Carrito ${suffix}`,
      slug: `vestido-carrito-${suffix}`,
      price: 20000,
      categoryId: category.id,
      variants: [{ size: "M", color: "Negro", sku: `CART-M-${suffix}`, onHand: 5 }],
    });
    createdProductIds.push(product.id);

    const other = await createProduct(prisma, {
      name: `Campera Carrito ${suffix}`,
      slug: `campera-carrito-${suffix}`,
      price: 30000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Azul", sku: `CART2-U-${suffix}`, onHand: 5 }],
    });
    createdProductIds.push(other.id);

    mockCartCookie([
      { variantId: product.variants[0].id, qty: 2 },
      { variantId: other.variants[0].id, qty: 1 },
    ]);

    render(await CartPage());

    expect(screen.getByText(product.name)).toBeInTheDocument();
    expect(screen.getByText("Talle M")).toBeInTheDocument();
    expect(screen.getByText(other.name)).toBeInTheDocument();
    // line totals: 20000*2 = 40000, 30000*1 = 30000
    expect(screen.getByText("$40.000")).toBeInTheDocument();
    expect(screen.getByText("$30.000")).toBeInTheDocument();
    // subtotal: 40000 + 30000 = 70000
    expect(screen.getByText("$70.000")).toBeInTheDocument();
  });

  it("shows a notice naming a dropped line when its product was deleted, without silently omitting it from view", async () => {
    const category = await makeCategory("carrito-dropped");
    const suffix = randomUUID();

    const product = await createProduct(prisma, {
      name: `Producto Borrado ${suffix}`,
      slug: `producto-borrado-${suffix}`,
      price: 15000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Negro", sku: `DROP-${suffix}`, onHand: 3 }],
    });
    const droppedVariantId = product.variants[0].id;
    await prisma.product.delete({ where: { id: product.id } });

    mockCartCookie([{ variantId: droppedVariantId, qty: 1 }]);

    render(await CartPage());

    expect(
      screen.getByText(/quitamos un artículo que ya no está disponible/i),
    ).toBeInTheDocument();
  });

  it("flags a line whose cart quantity exceeds current available stock, naming the remaining amount", async () => {
    const category = await makeCategory("carrito-overstock");
    const suffix = randomUUID();

    const product = await createProduct(prisma, {
      name: `Vestido Poco Stock ${suffix}`,
      slug: `vestido-poco-stock-${suffix}`,
      price: 18000,
      categoryId: category.id,
      variants: [{ size: "S", color: "Negro", sku: `OVER-${suffix}`, onHand: 1 }],
    });
    createdProductIds.push(product.id);

    mockCartCookie([{ variantId: product.variants[0].id, qty: 3 }]);

    render(await CartPage());

    expect(screen.getByText(/solo quedan 1\. ajustá la cantidad\./i)).toBeInTheDocument();
  });

  it("flags a line whose available stock reached zero as unavailable", async () => {
    const category = await makeCategory("carrito-zerostock");
    const suffix = randomUUID();

    const product = await createProduct(prisma, {
      name: `Vestido Sin Stock ${suffix}`,
      slug: `vestido-sin-stock-${suffix}`,
      price: 22000,
      categoryId: category.id,
      variants: [{ size: "M", color: "Negro", sku: `ZERO-${suffix}`, onHand: 0 }],
    });
    createdProductIds.push(product.id);

    mockCartCookie([{ variantId: product.variants[0].id, qty: 1 }]);

    render(await CartPage());

    expect(
      screen.getByText(/sin stock\. eliminá este artículo para continuar\./i),
    ).toBeInTheDocument();
  });
});
