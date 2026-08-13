import { test, expect } from "@playwright/test";

// Updated for Phase 3 (storefront-browsing): the Phase 1 placeholder home
// page (a bare <h1>Dominique</h1>) was replaced by the real home page
// (app/(store)/page.tsx + layout.tsx), where "Dominique" is the header
// brand link, not a heading. The pickup banner copy is unchanged.
test("home page loads with the Dominique brand link and pickup banner", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Dominique" })).toBeVisible();
  await expect(
    page.getByText("Retiro exclusivo en local físico", { exact: false }),
  ).toBeVisible();
});
