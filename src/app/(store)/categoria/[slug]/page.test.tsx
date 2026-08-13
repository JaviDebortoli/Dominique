import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import CategoryPage from "./page";

// Backs specs/storefront-browsing/spec.md "Category Listing": "the system
// SHALL list those products with price and thumbnail image", scoped to the
// browsed category only.
describe("Category listing page (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  it("lists the category's products with price and thumbnail, excluding other categories", async () => {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Accesorios Cat ${suffix}`, slug: `accesorios-cat-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const other = await prisma.category.create({
      data: { name: `Otra Cat ${suffix}`, slug: `otra-cat-${suffix}` },
    });
    createdCategoryIds.push(other.id);

    const product = await createProduct(prisma, {
      name: `Cinturon Categoria ${suffix}`,
      slug: `cinturon-categoria-${suffix}`,
      price: 18000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Marron", sku: `CINCAT-U-MAR-${suffix}`, onHand: 5 }],
      images: [
        { url: "/uploads/cinturon-cat.jpg", altText: "Cinturon de cuero marron", position: 0 },
      ],
    });
    createdProductIds.push(product.id);

    const otherProduct = await createProduct(prisma, {
      name: `Producto Otra Cat ${suffix}`,
      slug: `producto-otra-cat-${suffix}`,
      price: 5000,
      categoryId: other.id,
      variants: [{ size: "U", color: "Negro", sku: `OTRCAT-U-NEG-${suffix}`, onHand: 2 }],
    });
    createdProductIds.push(otherProduct.id);

    const ui = await CategoryPage({ params: Promise.resolve({ slug: category.slug }) });
    render(ui);

    expect(screen.getByText(product.name)).toBeInTheDocument();
    expect(screen.getByText("$18.000")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Cinturon de cuero marron" }),
    ).toHaveAttribute("src", "/uploads/cinturon-cat.jpg");
    expect(screen.queryByText(otherProduct.name)).not.toBeInTheDocument();
  });

  it("throws (notFound) for an unknown category slug", async () => {
    await expect(
      CategoryPage({ params: Promise.resolve({ slug: `nope-${randomUUID()}` }) }),
    ).rejects.toThrow();
  });
});
