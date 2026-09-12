import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import { recordInStoreSale } from "@/modules/sales/sale.service";
import ReportesPage from "./page";

// control-de-caja tasks.md 5.6 — runtime proof that the real force-dynamic
// server component renders real Postgres data, mirroring
// pedidos/page.test.tsx's precedent of calling the RSC directly and passing
// the result to render(). VoidSaleButton is a client descendant that calls
// useRouter() unconditionally on render, same as that file's mock.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

describe("/admin/reportes (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.sale.deleteMany({ where: { variant: { productId: { in: createdProductIds } } } });
    await prisma.stockMovement.deleteMany({
      where: { variant: { productId: { in: createdProductIds } } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makeVariant(onHand: number, price: number) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Reportes Page Test ${suffix}`, slug: `reportes-page-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    const product = await createProduct(prisma, {
      name: `Producto Reportes Page ${suffix}`,
      slug: `producto-reportes-page-${suffix}`,
      price,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `RPTPG-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);
    return { product, variant: product.variants[0] };
  }

  it("renders today's real in-person sale in both the totals table and the today's-sales list", async () => {
    const { product, variant } = await makeVariant(5, 7000);
    await recordInStoreSale(prisma, { variantId: variant.id, qty: 1, paymentMethod: "CASH" });

    const ui = await ReportesPage({ searchParams: Promise.resolve({}) });
    render(ui);

    // Appears twice: the Efectivo bucket row AND the grand total row (this
    // is the only revenue this test seeded).
    expect(screen.getAllByText(/\$\s?7\.000/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(product.name)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anular" })).toBeInTheDocument();
  });

  it("shows the honest limited-data message for a pre-ship-date range", async () => {
    const ui = await ReportesPage({
      searchParams: Promise.resolve({ desde: "2020-01-01", hasta: "2020-01-01" }),
    });
    render(ui);

    expect(screen.getByRole("status")).toHaveTextContent(/no hay datos de ventas en local/i);
  });
});
