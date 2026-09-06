import { test, expect } from "@playwright/test";

// Backs design.md "Resolved: Mobile Header Layout (~320px)" — the acceptance
// check that jsdom cannot see: at a 320px viewport with several categories and
// a multi-digit cart count, the centered wordmark must not collide with the
// absolutely-positioned right-side cluster (CategoryMenu + cart link), and the
// page itself must not overflow horizontally.
//
// Requires the seeded catalog fixtures (Vestidos / Remeras / Accesorios — 3
// categories) from prisma/seed.ts. The cart cookie is seeded directly with a
// large qty: getCart()/parseCart() only validate shape (string variantId +
// positive qty), the badge count is a pure sum, so no real variant row is
// needed to exercise the multi-digit-count layout.

const NARROW = { width: 320, height: 568 };

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

test.describe("Storefront header at 320px (design.md mobile header acceptance check)", () => {
  test.use({ viewport: NARROW });

  test("wordmark clears the right-side cluster and the page does not overflow horizontally", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "dominique_cart",
        value: JSON.stringify([{ variantId: "narrow-viewport-fixture", qty: 12 }]),
        url: "http://127.0.0.1:3100",
      },
    ]);

    await page.goto("/");

    // cartCount >= 10 is actually rendered.
    await expect(page.getByText("12", { exact: true })).toBeVisible();

    // >= 3 categories available in the header dropdown.
    const wordmark = page.getByRole("link", { name: "Dominique" });
    const cluster = page.getByRole("link", { name: /Carrito/ }).locator("..");

    const pageScrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    const wordmarkBox = await wordmark.boundingBox();
    const clusterBox = await cluster.boundingBox();

    expect(wordmarkBox, "wordmark must be rendered").not.toBeNull();
    expect(clusterBox, "header cluster must be rendered").not.toBeNull();

    // Record the measured geometry for apply-progress / verify.
    console.log(
      "HEADER_320_MEASURE",
      JSON.stringify({ pageScrollWidth, wordmarkBox, clusterBox }),
    );

    // (a) no horizontal page overflow at 320px
    expect(pageScrollWidth).toBe(NARROW.width);

    // (b) wordmark box does not intersect the cluster box
    expect(
      intersects(wordmarkBox!, clusterBox!),
      `wordmark ${JSON.stringify(wordmarkBox)} overlaps cluster ${JSON.stringify(clusterBox)}`,
    ).toBe(false);
  });
});
