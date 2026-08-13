import { test, expect } from "@playwright/test";

// End-to-end verification of specs/admin-console/spec.md "Authenticated
// Access" against the real running app (real proxy.ts, real next-auth
// session cookie, real Postgres) — tasks.md 7.1/7.2. This is the strongest
// available proof that the security-critical auth boundary works as a
// whole system, not just at the unit level (src/proxy.test.ts,
// src/modules/auth/admin-auth.service.test.ts already cover the pieces in
// isolation).
//
// Credentials: the DEV-ONLY fixture account created by
// prisma/seed.ts's seedAdminUser() (run `npm run db:seed` before this
// suite) — see that function's doc comment. Never used in production.
const DEV_ADMIN_EMAIL = "admin@dominique.local";
const DEV_ADMIN_PASSWORD = "Dominique-Dev-Only-2026!";

test.describe("Admin authentication (D7, tasks.md 7.1/7.2)", () => {
  test("unauthenticated access to an admin route is redirected to login, no admin data exposed", async ({
    page,
  }) => {
    await page.goto("/admin/caja");

    await expect(page).toHaveURL(/\/admin\/login/);
    // The caja table (and its stock numbers) must never render for an
    // unauthenticated visitor.
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("an invalid login attempt shows an error and does not grant access", async ({ page }) => {
    await page.goto("/admin/login");

    await page.getByLabel("Email").fill(DEV_ADMIN_EMAIL);
    await page.getByLabel("Contraseña").fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: /Ingresar/ }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("a valid login issues a session and unlocks the admin console", async ({ page }) => {
    await page.goto("/admin/login");

    await page.getByLabel("Email").fill(DEV_ADMIN_EMAIL);
    await page.getByLabel("Contraseña").fill(DEV_ADMIN_PASSWORD);
    await page.getByRole("button", { name: /Ingresar/ }).click();

    // Successful signIn() redirects to /admin/caja (login/actions.ts).
    await expect(page).toHaveURL(/\/admin\/caja/);
    await expect(page.getByRole("heading", { name: "Caja" })).toBeVisible();

    // The session persists across a fresh navigation to another admin
    // route — proving a real cookie was issued, not just a one-off
    // in-memory redirect.
    await page.goto("/admin/productos");
    await expect(page).toHaveURL(/\/admin\/productos/);
    await expect(page.getByRole("heading", { name: "Productos" })).toBeVisible();
  });

  test("signing out revokes access to admin routes again", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email").fill(DEV_ADMIN_EMAIL);
    await page.getByLabel("Contraseña").fill(DEV_ADMIN_PASSWORD);
    await page.getByRole("button", { name: /Ingresar/ }).click();
    await expect(page).toHaveURL(/\/admin\/caja/);

    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(/\/admin\/login/);

    await page.goto("/admin/caja");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
