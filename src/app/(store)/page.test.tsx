import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import StoreLayout from "./layout";
import Home from "./page";

// Backs specs/storefront-browsing/spec.md "Home Page Layout":
//   "the system SHALL display navigation, curated product sections, and
//   category entry points matching the mockup" (ejemplo/code.html).
// Integration test against real Postgres (design.md Testing Strategy) since
// both Home and StoreLayout are RSCs that read Prisma/services directly
// (design.md D1).
describe("Home page (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  it("renders navigation, curated products, and category entry points", async () => {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Vestidos Home ${suffix}`, slug: `vestidos-home-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Vestido Home ${suffix}`,
      slug: `vestido-home-${suffix}`,
      price: 45000,
      categoryId: category.id,
      variants: [{ size: "M", color: "Negro", sku: `VH-M-NEG-${suffix}`, onHand: 3 }],
      images: [{ url: "/uploads/vestido-home.jpg", position: 0 }],
    });
    createdProductIds.push(product.id);

    const layoutElement = await StoreLayout({ children: await Home() });
    render(layoutElement);

    // Navigation shows the real category, linking to its category page.
    const navLink = screen.getAllByRole("link", { name: category.name })[0];
    expect(navLink).toHaveAttribute("href", `/categoria/${category.slug}`);

    // Curated products section shows the product name + formatted price,
    // scoped to this product's own card — the shared dev DB may already
    // contain other seeded/fixture products (e.g. prisma/seed.ts's
    // catalog fixtures), so assertions must not assume a pristine DB.
    const productCard = screen.getByRole("link", {
      name: new RegExp(product.name),
    });
    expect(within(productCard).getByText("$45.000")).toBeInTheDocument();

    // Category entry point tile also links to the category page (nav + tile).
    const categoryLinks = screen.getAllByRole("link", { name: category.name });
    expect(categoryLinks.length).toBeGreaterThanOrEqual(2);

    // Pickup banner copy from ejemplo/code.html.
    expect(
      screen.getByText("Retiro exclusivo en local físico", { exact: false }),
    ).toBeInTheDocument();
  });
});
