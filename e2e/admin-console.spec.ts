import { test, expect } from "@playwright/test";

// End-to-end verification of the admin console's core workflows against
// the real running app + real Postgres, using prisma/seed.ts's fixtures
// (run `npm run db:seed` before this suite) and the DEV-ONLY admin login
// (seedAdminUser()). tasks.md 7.3, 7.6, 7.7, 7.10.
const DEV_ADMIN_EMAIL = "admin@dominique.local";
const DEV_ADMIN_PASSWORD = "Dominique-Dev-Only-2026!";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(DEV_ADMIN_EMAIL);
  await page.getByLabel("Contraseña").fill(DEV_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Ingresar/ }).click();
  await expect(page).toHaveURL(/\/admin\/caja/);
}

test.describe("Admin caja — stock view (design.md rule 4c, tasks.md 7.6/7.7/7.10)", () => {
  test("shows disponible/reservado/en depósito per row and an in-store sale decrements disponible immediately", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    // "Remera Basica" (seedCatalogFixtures) — onHand 3, no holds.
    const row = page.getByRole("row", { name: /Remera Basica/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText("3"); // disponible

    await row.getByRole("button", { name: "Vender 1" }).click();

    // router.refresh() re-reads the live DB row (force-dynamic, tasks.md
    // 7.6) — the SAME table cell now shows the decremented count, with no
    // page reload and no separate cache to invalidate.
    await expect(row).toContainText("2");
  });
});

test.describe("Admin productos — create a product (tasks.md 7.3)", () => {
  test("owner creates a product with a variant, unaided, and it's immediately listed", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    await page.goto("/admin/productos/nuevo");
    const suffix = Date.now();

    await page.getByLabel("Nombre").fill(`Producto E2E ${suffix}`);
    await page.getByLabel("Slug").fill(`producto-e2e-${suffix}`);
    await page.getByLabel("Precio").fill("25000");
    // "Vestidos" is the first seeded category (alphabetical) — default
    // selection is fine, no need to change it.

    await page.getByPlaceholder("Talle").fill("U");
    await page.getByPlaceholder("Color").fill("Unico");
    await page.getByPlaceholder("SKU").fill(`E2E-${suffix}`);
    await page.getByPlaceholder("Stock").fill("7");

    await page.getByRole("button", { name: "Guardar producto" }).click();

    await expect(page).toHaveURL(/\/admin\/productos$/);
    await expect(page.getByText(`Producto E2E ${suffix}`)).toBeVisible();
  });
});

test.describe("Admin categorias — create a category (tasks.md 6.1)", () => {
  test("owner creates a category unaided and it appears in both the categories list and the product form's picker", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    await page.goto("/admin/categorias");
    const suffix = Date.now();
    const categoryName = `Categoria E2E ${suffix}`;

    await page.getByLabel(/^Nombre/).fill(categoryName);
    // Slug left at its auto-suggested value (specs/admin-console/spec.md
    // "Owner creates a category unaided").
    await page.getByRole("button", { name: "Crear categoría" }).click();

    const row = page.getByRole("row", { name: new RegExp(categoryName) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("0"); // product count

    await page.goto("/admin/productos/nuevo");
    await expect(
      page.getByLabel("Categoría").locator(`option:has-text("${categoryName}")`),
    ).toBeAttached();
  });
});
