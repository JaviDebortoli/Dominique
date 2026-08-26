import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.test", override: true });
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";

// End-to-end verification of the full add-to-cart → edit → checkout →
// empty-cart journey introduced by openspec/changes/carrito-completo
// (tasks.md 4.2), against the real running app + real Postgres. Mirrors
// e2e/admin-productos-edicion.spec.ts's house style: self-cleaning
// randomUUID()-suffixed fixtures created directly via Prisma, cleaned up in
// afterAll.
//
// No login step — the storefront has no auth concept for guests; only
// /admin/* sits behind proxy.ts's ["/admin/:path*"] matcher (re-confirmed
// by reading that file again, tasks.md 4.3), and /carrito, /producto/*, and
// /checkout are all outside it.
test.describe("Cart journey: PDP → /carrito → /checkout → empty cart (tasks.md 4.2)", () => {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const categoryName = `Categoria E2E Carrito ${suffix}`;
  const productAName = `Producto E2E Carrito A ${suffix}`;
  const productBName = `Producto E2E Carrito B ${suffix}`;
  const productASlug = `producto-e2e-carrito-a-${suffix}`;
  const productBSlug = `producto-e2e-carrito-b-${suffix}`;
  // Matches cart-lines.ts's ResolvedCartLine.label format exactly
  // (`${productName} — Talle ${size}`) — the single source of the label
  // used by /carrito's CartLineControls aria-labels and /checkout's line
  // items.
  const labelA = `${productAName} — Talle M`;

  let categoryId: string;
  let productAId: string;
  let productBId: string;
  let variantAId: string;
  let variantBId: string;

  test.beforeAll(async () => {
    const category = await prisma.category.create({
      data: { name: categoryName, slug: `categoria-e2e-carrito-${suffix}` },
    });
    categoryId = category.id;

    const productA = await createProduct(prisma, {
      name: productAName,
      slug: productASlug,
      price: 20000,
      categoryId,
      variants: [{ size: "M", color: "Unico", sku: `CART-A-${suffix}`, onHand: 5 }],
    });
    productAId = productA.id;
    variantAId = productA.variants[0].id;

    const productB = await createProduct(prisma, {
      name: productBName,
      slug: productBSlug,
      price: 15000,
      categoryId,
      variants: [{ size: "U", color: "Unico", sku: `CART-B-${suffix}`, onHand: 5 }],
    });
    productBId = productB.id;
    variantBId = productB.variants[0].id;
  });

  test.afterAll(async () => {
    const variantIds = [variantAId, variantBId];
    // The checkout order created mid-test is not tracked by id directly (it
    // is created through the UI, not a direct Prisma call) — discovered
    // here via the variants it references, same self-cleaning spirit as
    // admin-productos-edicion.spec.ts's tracked-id arrays.
    const orderItems = await prisma.orderItem.findMany({
      where: { variantId: { in: variantIds } },
      select: { orderId: true },
    });
    const orderIds = [...new Set(orderItems.map((item) => item.orderId))];

    await prisma.stockMovement.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.stockMovement.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.product.deleteMany({ where: { id: { in: [productAId, productBId] } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
  });

  test("adds two products, edits quantity, removes a line, checks out with PICKUP_CASH, and empties the cart", async ({
    page,
    context,
  }) => {
    // Fresh cart cookie regardless of any prior run sharing this worker.
    await context.clearCookies();

    // 1. PDP → select size → "Agregar al carrito".
    await page.goto(`/producto/${productASlug}`);
    await page.getByRole("button", { name: "M", exact: true }).click();
    await page.getByRole("button", { name: "Agregar al carrito" }).click();

    // 2. Header badge reflects the add (design.md D2/D3 — server-derived,
    // refreshed via a Server Action, no client state).
    await expect(page.getByRole("link", { name: "Carrito, 1 artículos" })).toBeVisible();

    // 3. /carrito shows the line.
    await page.goto("/carrito");
    await expect(page.getByText(productAName)).toBeVisible();
    await expect(page.getByText("Talle M")).toBeVisible();

    // 4. Edit quantity up via the stepper.
    await page.getByRole("button", { name: `Sumar cantidad de ${labelA}` }).click();
    await expect(page.getByRole("link", { name: "Carrito, 2 artículos" })).toBeVisible();

    // 5. Add a second product from its own PDP.
    await page.goto(`/producto/${productBSlug}`);
    await page.getByRole("button", { name: "U", exact: true }).click();
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    await expect(page.getByRole("link", { name: "Carrito, 3 artículos" })).toBeVisible();

    // 6. Back on /carrito with both lines — remove product B's line via its
    // explicit "Eliminar" action. Scoped to the <li> containing product B's
    // name (not getByRole("listitem") — Tailwind's preflight resets
    // `list-style: none` on <ul>, which strips the implicit list/listitem
    // ARIA role in Chromium; a plain tag locator is unaffected by that).
    await page.goto("/carrito");
    await expect(page.getByText(productBName)).toBeVisible();
    const lineB = page.locator("li").filter({ hasText: productBName });
    await lineB.getByRole("button", { name: "Eliminar" }).click();

    await expect(page.getByText(productBName)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Carrito, 2 artículos" })).toBeVisible();

    // 7. Proceed to checkout — payment-only summary of the remaining line.
    await page.getByRole("link", { name: "Ir a pagar" }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByText(labelA)).toBeVisible();

    // 8. Complete the order with PICKUP_CASH (simplest — no MercadoPago
    // sandbox needed).
    const contactSuffix = randomUUID().replace(/-/g, "").slice(0, 8);
    await page.getByLabel("Nombre").fill(`Cliente E2E ${suffix}`);
    await page.getByLabel("Teléfono").fill(`381555${contactSuffix.slice(0, 4)}`);
    await page.getByLabel("Email").fill(`cliente-e2e-${contactSuffix}@example.com`);
    await page.getByRole("radio", { name: "Reservar y pagar al retirar" }).check();
    await page.getByRole("button", { name: "Confirmar pedido" }).click();

    await expect(page.getByText(/Pedido confirmado/)).toBeVisible();
    await expect(page.getByText(/DOM-/)).toBeVisible();

    // 9. The cart is empty afterward (specs/cart-checkout "Cart Cleared
    // After Order Creation").
    await page.goto("/carrito");
    await expect(page.getByText("Tu carrito está vacío.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Carrito, 0 artículos" })).toBeVisible();
  });
});
