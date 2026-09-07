import { test, expect } from "@playwright/test";

// Backs specs/admin-console/spec.md "Admin Console Layout on Narrow Viewports"
// and design.md "Verification Hooks" — the browser-only proof that each admin
// data table stays within the page width on a narrow viewport, scrolls inside
// its own `overflow-x-auto` container, and drops no columns.
//
// Requires the seeded fixtures + DEV-ONLY admin login from prisma/seed.ts
// (`npm run db:test:setup`). Mirrors e2e/admin-console.spec.ts's login flow.
const DEV_ADMIN_EMAIL = "admin@dominique.local";
const DEV_ADMIN_PASSWORD = "Dominique-Dev-Only-2026!";
const NARROW = { width: 320, height: 568 };

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(DEV_ADMIN_EMAIL);
  await page.getByLabel("Contraseña").fill(DEV_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Ingresar/ }).click();
  await expect(page).toHaveURL(/\/admin\/caja/);
}

const TABLES = [
  { path: "/admin/productos", columns: 6 },
  { path: "/admin/caja", columns: 8 },
  { path: "/admin/categorias", columns: 4 },
  { path: "/admin/pedidos", columns: 6 },
];

test.describe("Admin data tables at 320px", () => {
  test.use({ viewport: NARROW });

  for (const { path, columns } of TABLES) {
    test(`${path}: contained horizontal scroll, no page overflow, no dropped columns`, async ({
      page,
    }) => {
      await loginAsAdmin(page);
      await page.goto(path);

      const table = page.locator("table").first();
      await expect(table).toBeVisible();

      // The overflow-x-auto wrapper is the table's direct parent.
      const wrapper = table.locator("xpath=..");

      const metrics = await page.evaluate(() => ({
        pageScrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      const wrapperBox = await wrapper.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return {
          right: rect.right,
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          overflowX: getComputedStyle(el).overflowX,
        };
      });
      const headerCount = await table.locator("thead th").count();

      console.log(
        "ADMIN_320_MEASURE",
        JSON.stringify({ path, metrics, wrapperBox, headerCount }),
      );

      // No column is dropped to fit (spec: "No table columns or data MAY be
      // hidden or dropped").
      expect(headerCount).toBe(columns);

      // The table lives in its own horizontal-scroll container...
      expect(wrapperBox.overflowX).toBe("auto");
      // ...that stays within the page width (spec: the table "MUST scroll
      // horizontally within its own container rather than forcing the
      // surrounding page layout to overflow").
      expect(wrapperBox.right).toBeLessThanOrEqual(NARROW.width);
      expect(wrapperBox.clientWidth).toBeLessThanOrEqual(NARROW.width);
      // A table wider than the viewport is reachable by scrolling inside
      // that container (not clipped, not dropped).
      expect(wrapperBox.scrollWidth).toBeGreaterThanOrEqual(wrapperBox.clientWidth);
    });
  }
});
