import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import ProductPage from "./page";

// Backs specs/storefront-browsing/spec.md:
//   - "Product Detail Page Variant Selector" (enable in-stock size, disable
//     zero-stock size)
//   - "Locale and Copy" ("Sin stock" es-AR label)
// and tasks.md 3.4 (add-to-cart enabled only for a selected in-stock
// variant).
describe("PDP (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  it("shows product info and a size selector enabling in-stock, disabling zero-stock with Sin stock", async () => {
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
    await expect(
      ProductPage({ params: Promise.resolve({ slug: `nope-${randomUUID()}` }) }),
    ).rejects.toThrow();
  });
});
