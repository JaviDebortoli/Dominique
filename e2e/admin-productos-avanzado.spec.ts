import "dotenv/config";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";

// End-to-end verification of specs/admin-console/spec.md "Owner adds a
// variant to an existing product" against the real running app + real
// Postgres (tasks.md 3.1, PR 1 of 2 — variant-add slice). Mirrors
// e2e/admin-productos-edicion.spec.ts's loginAsAdmin() helper and
// DEV_ADMIN_* credentials (prisma/seed.ts's seedAdminUser()).
//
// The image add/delete scenarios (design.md G1-G4/G7/G8) are PR 2 and are
// added to this same spec file by tasks.md Phase 8, not here.

const DEV_ADMIN_EMAIL = "admin@dominique.local";
const DEV_ADMIN_PASSWORD = "Dominique-Dev-Only-2026!";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(DEV_ADMIN_EMAIL);
  await page.getByLabel("Contraseña").fill(DEV_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Ingresar/ }).click();
  await expect(page).toHaveURL(/\/admin\/caja/);
}

test.describe("Admin productos — avanzado: add variant (tasks.md 3.1)", () => {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const categoryName = `Categoria E2E Avanzado ${suffix}`;
  const productName = `Producto E2E Avanzado ${suffix}`;
  const productSlug = `producto-e2e-avanzado-${suffix}`;
  const newVariantSku = `AVZ-VAR-${suffix}`;

  let categoryId: string;
  let productId: string;

  test.beforeAll(async () => {
    const category = await prisma.category.create({
      data: { name: categoryName, slug: `categoria-e2e-avanzado-${suffix}` },
    });
    categoryId = category.id;

    const product = await createProduct(prisma, {
      name: productName,
      slug: productSlug,
      price: 15000,
      categoryId,
      variants: [{ size: "M", color: "Negro", sku: `AVZ-BASE-${suffix}`, onHand: 2 }],
    });
    productId = product.id;
  });

  test.afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
  });

  test("owner adds a variant to an existing product", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/productos");

    const row = page.getByRole("row", { name: new RegExp(productName) });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "1" }).click();

    await page.getByLabel(/talle/i).fill("L");
    await page.getByLabel(/color/i).fill("Negro");
    await page.getByLabel(/^sku$/i).fill(newVariantSku);
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes(`/api/admin/products/${productId}/variants`) && res.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Agregar" }).click(),
    ]);
    expect(response.status()).toBe(201);

    await expect(page.getByText(newVariantSku)).toBeVisible();
    // No stock column is exposed on the newly created variant's sub-row —
    // its onHand: 0 is not surfaced as an editable/visible number here.
    await expect(page.getByLabel(/stock/i)).toHaveCount(0);
  });
});
