import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import ProductPage from "./page";

// Backs specs/storefront-browsing/spec.md:
//   - "Product Detail Page Variant Selector" (enable in-stock size, disable
//     zero-stock size)
//   - "Locale and Copy" ("Sin stock" es-AR label)
// and tasks.md 3.4 (add-to-cart enabled only for a selected in-stock
// variant), 2.3 (DA-1 at-cap disable via inCartQty, read from the cart
// cookie). `next/headers`'s `cookies()` is mocked because it only resolves
// inside a real Next.js request/render, which this direct
// async-component-call harness is not — mirrors carrito/page.test.tsx's
// pattern.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
const mockedCookies = vi.mocked(cookies);

function mockCartCookie(items: { variantId: string; qty: number }[] | null = null) {
  mockedCookies.mockResolvedValue({
    get: () => (items ? { value: JSON.stringify(items) } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

describe("PDP (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  it("shows product info and a size selector enabling in-stock, disabling zero-stock with Sin stock", async () => {
    mockCartCookie(null);
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Vestidos PDP ${suffix}`, slug: `vestidos-pdp-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Vestido Talles ${suffix}`,
      slug: `vestido-talles-${suffix}`,
      price: 47000,
      categoryId: category.id,
      variants: [
        { size: "M", color: "Negro", sku: `VT-M-NEG-${suffix}`, onHand: 4 },
        { size: "S", color: "Negro", sku: `VT-S-NEG-${suffix}`, onHand: 0 },
      ],
      images: [{ url: "/uploads/vestido-talles.jpg", position: 0 }],
    });
    createdProductIds.push(product.id);

    const ui = await ProductPage({ params: Promise.resolve({ slug: product.slug }) });
    render(ui);

    expect(screen.getByText(product.name)).toBeInTheDocument();
    expect(screen.getByText("$47.000")).toBeInTheDocument();

    const sizeM = screen.getByRole("button", { name: "M" });
    const sizeS = screen.getByRole("button", { name: "S" });
    expect(sizeM).toBeEnabled();
    expect(sizeS).toBeDisabled();
    expect(screen.getByText("Sin stock")).toBeInTheDocument();

    const addToCart = screen.getByRole("button", { name: /agregar al carrito/i });
    expect(addToCart).toBeDisabled();

    const user = userEvent.setup();
    await user.click(sizeM);
    expect(addToCart).toBeEnabled();
  });

  it("throws (notFound) for an unknown product slug", async () => {
    mockCartCookie(null);
    await expect(
      ProductPage({ params: Promise.resolve({ slug: `nope-${randomUUID()}` }) }),
    ).rejects.toThrow();
  });

  // DA-1 (design.md, confirmed by owner): no quantity input on the PDP —
  // the cap against available stock disables "Agregar al carrito" with a
  // named reason once the cart cookie already holds `available` units.
  it("disables add to cart with the named at-cap reason when the cart cookie already holds all available stock", async () => {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Vestidos PDP Cap ${suffix}`, slug: `vestidos-pdp-cap-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Vestido Al Máximo ${suffix}`,
      slug: `vestido-al-maximo-${suffix}`,
      price: 30000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Negro", sku: `CAP-${suffix}`, onHand: 2 }],
      images: [{ url: "/uploads/vestido-al-maximo.jpg", position: 0 }],
    });
    createdProductIds.push(product.id);

    mockCartCookie([{ variantId: product.variants[0].id, qty: 2 }]);

    const ui = await ProductPage({ params: Promise.resolve({ slug: product.slug }) });
    render(ui);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "U" }));

    const addToCart = screen.getByRole("button", { name: "Ya tenés el máximo disponible" });
    expect(addToCart).toBeDisabled();
  });
});
