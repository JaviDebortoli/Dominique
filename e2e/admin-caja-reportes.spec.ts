import { test, expect } from "@playwright/test";

// End-to-end verification of control-de-caja's core loop against the real
// running app + real (test) Postgres, matching e2e/admin-console.spec.ts's
// conventions. tasks.md 6.1: sell with a payment method → report shows it →
// void → report drops it and stock returns.
const DEV_ADMIN_EMAIL = "admin@dominique.local";
const DEV_ADMIN_PASSWORD = "Dominique-Dev-Only-2026!";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(DEV_ADMIN_EMAIL);
  await page.getByLabel("Contraseña").fill(DEV_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Ingresar/ }).click();
  await expect(page).toHaveURL(/\/admin\/caja/);
}

test.describe("Admin caja + reportes — sell, report, void (control-de-caja tasks.md 6.1)", () => {
  test("sell with Efectivo -> shows in the report -> anular -> drops from the report and stock returns", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    // Seeds its own product (rather than a shared seed fixture) so this
    // scenario is self-contained under fullyParallel — mirrors
    // admin-console.spec.ts's "Producto E2E" pattern.
    const suffix = Date.now();
    const productName = `Producto Caja E2E ${suffix}`;
    const sku = `CAJAE2E-${suffix}`;

    await page.goto("/admin/productos/nuevo");
    await page.getByLabel("Nombre").fill(productName);
    await page.getByLabel("Slug").fill(`producto-caja-e2e-${suffix}`);
    await page.getByLabel("Precio").fill("9000");
    await page.getByPlaceholder("Talle").fill("U");
    await page.getByPlaceholder("Color").fill("Unico");
    await page.getByPlaceholder("SKU").fill(sku);
    await page.getByPlaceholder("Stock").fill("3");
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await expect(page).toHaveURL(/\/admin\/productos$/);

    // --- Sell 1 unit with Efectivo -----------------------------------
    await page.goto("/admin/caja");
    const cajaRow = page.getByRole("row", { name: new RegExp(productName) });
    await expect(cajaRow).toBeVisible();
    await expect(cajaRow).toContainText("3"); // disponible

    await cajaRow.getByRole("button", { name: "Vender 1" }).click();
    const sellResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/stock/sell") && response.request().method() === "POST",
    );
    await cajaRow.getByRole("button", { name: "Efectivo" }).click();
    const sellResponse = await sellResponsePromise;
    expect(sellResponse.ok()).toBe(true);

    await expect(cajaRow).toContainText("2"); // disponible, decremented

    // --- Report shows it ----------------------------------------------
    await page.goto("/admin/reportes");
    const salesRow = page.getByRole("row", { name: new RegExp(productName) });
    await expect(salesRow).toBeVisible();
    await expect(salesRow).toContainText("Efectivo");

    // --- Anular ---------------------------------------------------------
    await salesRow.getByRole("button", { name: "Anular" }).click();
    const voidResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/sales/") &&
        response.url().includes("/void") &&
        response.request().method() === "POST",
    );
    await salesRow.getByRole("button", { name: "Confirmar" }).click();
    const voidResponse = await voidResponsePromise;
    expect(voidResponse.ok()).toBe(true);

    // --- Report drops it, stock returns --------------------------------
    await page.reload();
    await expect(page.getByRole("row", { name: new RegExp(`${productName}.*\\(anulada\\)`) })).toBeVisible();
    await expect(
      page.getByRole("row", { name: new RegExp(productName) }).getByRole("button", { name: "Anular" }),
    ).toHaveCount(0);

    await page.goto("/admin/caja");
    await expect(page.getByRole("row", { name: new RegExp(productName) })).toContainText("3");
  });
});
