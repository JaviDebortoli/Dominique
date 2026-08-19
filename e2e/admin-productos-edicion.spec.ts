import "dotenv/config";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";

// End-to-end verification of specs/admin-console/spec.md "Owner edits a
// product's core fields" and "Product delete blocked by order/stock
// history" against the real running app + real Postgres (tasks.md
// 6.1/6.2). Mirrors e2e/admin-console.spec.ts's loginAsAdmin() helper and
// DEV_ADMIN_* credentials (prisma/seed.ts's seedAdminUser()).
//
// Fixtures are created directly here (not via prisma/seed.ts, and not by
// driving the full checkout UI) with a randomUUID()-derived suffix in
// every name/slug/sku — same self-cleaning convention as
// e2e/admin-console.spec.ts's "Categoria E2E {timestamp}" and
// product.service.test.ts's real-Postgres integration tests — and removed
// in afterAll. The order/stock-movement history fixture is built the same
// way product.service.test.ts's "throws ProductHasHistoryError" case
// builds one (an OrderItem + a StockMovement pointing at the product's
// variant), since no seeded fixture already carries order history and
// driving a full MercadoPago/pickup checkout here would test the checkout
// flow, not this change.

const DEV_ADMIN_EMAIL = "admin@dominique.local";
const DEV_ADMIN_PASSWORD = "Dominique-Dev-Only-2026!";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(DEV_ADMIN_EMAIL);
  await page.getByLabel("Contraseña").fill(DEV_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Ingresar/ }).click();
  await expect(page).toHaveURL(/\/admin\/caja/);
}

test.describe("Admin productos — edit and delete (tasks.md 6.1/6.2)", () => {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const categoryAName = `Categoria E2E Edicion A ${suffix}`;
  const categoryBName = `Categoria E2E Edicion B ${suffix}`;
  const editProductName = `Producto E2E Edicion ${suffix}`;
  const historyProductName = `Producto E2E Historial ${suffix}`;
  const editProductSlug = `producto-e2e-edicion-${suffix}`;

  let categoryAId: string;
  let categoryBId: string;
  let editProductId: string;
  let historyProductId: string;
  let historyOrderId: string;

  test.beforeAll(async () => {
    const categoryA = await prisma.category.create({
      data: { name: categoryAName, slug: `categoria-e2e-edicion-a-${suffix}` },
    });
    const categoryB = await prisma.category.create({
      data: { name: categoryBName, slug: `categoria-e2e-edicion-b-${suffix}` },
    });
    categoryAId = categoryA.id;
    categoryBId = categoryB.id;

    const editProduct = await createProduct(prisma, {
      name: editProductName,
      slug: editProductSlug,
      price: 10000,
      categoryId: categoryAId,
      variants: [{ size: "U", color: "Unico", sku: `EDIT-E2E-${suffix}`, onHand: 3 }],
    });
    editProductId = editProduct.id;

    const historyProduct = await createProduct(prisma, {
      name: historyProductName,
      slug: `producto-e2e-historial-${suffix}`,
      price: 12000,
      categoryId: categoryAId,
      variants: [{ size: "U", color: "Unico", sku: `HIST-E2E-${suffix}`, onHand: 0 }],
    });
    historyProductId = historyProduct.id;
    const historyVariant = historyProduct.variants[0];

    const order = await prisma.order.create({
      data: {
        publicCode: `E2E-HIST-${suffix}`,
        buyerName: "Compradora E2E",
        phone: "3800000000",
        email: `e2e-hist-${suffix}@example.com`,
        method: "PICKUP_CASH",
        status: "PAID",
        items: { create: [{ variantId: historyVariant.id, qty: 1, unitPrice: 12000 }] },
      },
    });
    historyOrderId = order.id;
    await prisma.stockMovement.create({
      data: { variantId: historyVariant.id, delta: 1, reason: "PAID", orderId: order.id },
    });
  });

  test.afterAll(async () => {
    // RESTRICT on orderId/variantId means the order's history rows must go
    // before the historyProduct's cascading variant delete (mirrors
    // product.service.test.ts's afterAll cleanup order).
    await prisma.stockMovement.deleteMany({ where: { orderId: historyOrderId } });
    await prisma.order.delete({ where: { id: historyOrderId } });
    await prisma.product.deleteMany({ where: { id: { in: [editProductId, historyProductId] } } });
    await prisma.category.deleteMany({ where: { id: { in: [categoryAId, categoryBId] } } });
  });

  test("owner corrects a mistyped price and a wrong category", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/productos");

    const row = page.getByRole("row", { name: new RegExp(editProductName) });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Editar" }).click();

    await page.getByLabel(/precio/i).fill("13500");
    await page.getByLabel(/categoría/i).selectOption(categoryBId);
    await page.getByRole("button", { name: "Guardar" }).click();

    const updatedRow = page.getByRole("row", { name: new RegExp(editProductName) });
    await expect(updatedRow).toContainText("$13.500");
    await expect(updatedRow).toContainText(categoryBName);

    await page.goto(`/producto/${editProductSlug}`);
    await expect(page).toHaveURL(new RegExp(`/producto/${editProductSlug}$`));
    await expect(page.getByText("$13.500")).toBeVisible();
  });

  test("deleting a product that has an order shows the history message and removes nothing", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/productos");

    const row = page.getByRole("row", { name: new RegExp(historyProductName) });
    await expect(row).toBeVisible();

    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await row.getByRole("button", { name: "Eliminar" }).click();

    // Scoped to the row itself — the page also carries Next.js's own
    // permanent role="alert" route announcer, which page.getByRole("alert")
    // would otherwise also match (strict mode violation).
    await expect(row.getByRole("alert")).toContainText("venta");
    await expect(page.getByRole("row", { name: new RegExp(historyProductName) })).toBeVisible();
  });
});
