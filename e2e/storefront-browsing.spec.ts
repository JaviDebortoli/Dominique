import { test, expect } from "@playwright/test";

// End-to-end verification of specs/storefront-browsing/spec.md against the
// real running app + real Postgres, using the fixtures seeded by
// prisma/seed.ts's seedCatalogFixtures() (Vestidos/Remeras/Accesorios,
// with "Vestido Roma" carrying one sold-out size for the "Sin stock"
// scenario). Run `npm run db:seed` before this suite.

test.describe("Home page (tasks.md 3.1)", () => {
  test("renders navigation, curated products, and category entry points matching the mockup", async ({
    page,
  }) => {
    await page.goto("/");

    // Navigation — real categories, not mockup placeholders.
    await expect(
      page.getByRole("navigation", { name: "Categorías" }).getByRole("link", { name: "Vestidos" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Categorías" }).getByRole("link", { name: "Remeras" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Categorías" }).getByRole("link", { name: "Accesorios" }),
    ).toBeVisible();

    // Curated products section.
    await expect(page.getByRole("heading", { name: "Selección Dominique" })).toBeVisible();
    await expect(page.getByText("Vestido Roma")).toBeVisible();

    // Category entry points (tiles) link to /categoria/{slug}.
    await expect(page.getByRole("link", { name: /Vestidos/ }).first()).toHaveAttribute(
      "href",
      "/categoria/vestidos",
    );
  });
});

test.describe("Category listing page (tasks.md 3.2)", () => {
  test("lists active products in the category with price and thumbnail", async ({ page }) => {
    await page.goto("/categoria/vestidos");

    await expect(page.getByRole("heading", { name: "Vestidos" })).toBeVisible();
    await expect(page.getByText("Vestido Roma")).toBeVisible();
    await expect(page.getByText("$45.000")).toBeVisible();

    // Products from other categories are excluded.
    await expect(page.getByText("Remera Basica")).toHaveCount(0);
  });
});

test.describe("Product detail page — size selector (tasks.md 3.3, 3.4)", () => {
  test("enables an in-stock size and disables a zero-stock size labeled Sin stock", async ({
    page,
  }) => {
    await page.goto("/producto/vestido-roma");

    await expect(page.getByRole("heading", { name: "Vestido Roma" })).toBeVisible();

    // exact: true — Playwright's role-name matching defaults to a
    // case-insensitive substring match (unlike Testing Library's exact
    // default), so a bare "S" would also match the Next.js dev-tools
    // overlay button and the footer's "Suscribirse" button.
    const sizeM = page.getByRole("button", { name: "M", exact: true });
    const sizeS = page.getByRole("button", { name: "S", exact: true });
    await expect(sizeM).toBeEnabled();
    await expect(sizeS).toBeDisabled();
    await expect(page.getByText("Sin stock")).toBeVisible();

    const addToCart = page.getByRole("button", { name: /Agregar al carrito/i });
    await expect(addToCart).toBeDisabled();

    await sizeM.click();
    await expect(addToCart).toBeEnabled();
  });
});
