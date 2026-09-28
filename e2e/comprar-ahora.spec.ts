import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.test", override: true });
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";

// End-to-end verification of the "Comprar ahora" (buy-now) journey
// introduced by odd/tasks/comprar-ahora.md, against the real running app +
// real Postgres. Mirrors e2e/carrito.spec.ts's house style: self-cleaning
// randomUUID()-suffixed fixtures created directly via Prisma, cleaned up in
// afterAll.
//
// Owner-confirmed requirement (odd/tasks/comprar-ahora.md): a buy-now
// purchase must leave the shopper's existing cart cookie intact — this spec
// proves that end to end, not just at the route-test level.
test.describe("Buy-now journey: add A to cart, buy B directly, cart A survives (comprar-ahora.md T4)", () => {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const categoryName = `Categoria E2E Comprar Ahora ${suffix}`;
  const productAName = `Producto E2E Comprar Ahora A ${suffix}`;
  const productBName = `Producto E2E Comprar Ahora B ${suffix}`;
  const productASlug = `producto-e2e-comprar-ahora-a-${suffix}`;
  const productBSlug = `producto-e2e-comprar-ahora-b-${suffix}`;
  // Matches cart-lines.ts's ResolvedCartLine.label format exactly
  // (`${productName} — Talle ${size} — Color ${color}`) — the single source of the label
  // used by /carrito and /checkout.
  const labelB = `${productBName} — Talle U — Color Unico`;

  let categoryId: string;
  let productAId: string;
  let productBId: string;
  let variantAId: string;
  let variantBId: string;

  test.beforeAll(async () => {
    const category = await prisma.category.create({
      data: { name: categoryName, slug: `categoria-e2e-comprar-ahora-${suffix}` },
    });
    categoryId = category.id;

    const productA = await createProduct(prisma, {
      name: productAName,
      slug: productASlug,
      price: 20000,
      categoryId,
      variants: [{ size: "M", color: "Unico", sku: `BUYNOW-A-${suffix}`, onHand: 5 }],
    });
    productAId = productA.id;
    variantAId = productA.variants[0].id;

    const productB = await createProduct(prisma, {
      name: productBName,
      slug: productBSlug,
      price: 30000,
      categoryId,
      variants: [{ size: "U", color: "Unico", sku: `BUYNOW-B-${suffix}`, onHand: 5 }],
    });
    productBId = productB.id;
    variantBId = productB.variants[0].id;
  });

  test.afterAll(async () => {
    const variantIds = [variantAId, variantBId];
    // The checkout order created mid-test is not tracked by id directly (it
    // is created through the UI, not a direct Prisma call) — discovered
    // here via the variants it references, same self-cleaning spirit as
    // e2e/carrito.spec.ts.
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

  test("buying B directly reaches checkout with only B qty 1, and A's cart line survives", async ({
    page,
    context,
  }) => {
    // Fresh cart cookie regardless of any prior run sharing this worker.
    await context.clearCookies();

    // 1. Add product A to the cart the normal way.
    await page.goto(`/producto/${productASlug}`);
    await page.getByRole("button", { name: "M", exact: true }).click();
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    await expect(page.getByRole("link", { name: "Carrito, 1 artículos" })).toBeVisible();

    // 2. On product B's PDP, select its size and buy it directly instead of
    // adding it to the cart.
    await page.goto(`/producto/${productBSlug}`);
    await page.getByRole("button", { name: "U", exact: true }).click();
    await page.getByRole("button", { name: "Comprar ahora" }).click();

    // 3. Checkout shows exactly B, qty 1 — never A (the cart's contents).
    await expect(page).toHaveURL(/\/checkout\?variante=/);
    await expect(page.getByText(labelB)).toBeVisible();
    await expect(page.getByText(productAName)).toHaveCount(0);

    // 4. The header badge still shows A's line — buy-now never touched the
    // cart cookie (visible proof, not just a DB assertion after the fact).
    await expect(page.getByRole("link", { name: "Carrito, 1 artículos" })).toBeVisible();

    // 5. Complete the buy-now order with PICKUP_CASH.
    const contactSuffix = randomUUID().replace(/-/g, "").slice(0, 8);
    const phoneDigits = Date.now().toString().slice(-4);
    await page.getByLabel("Nombre").fill(`Cliente E2E Comprar Ahora ${suffix}`);
    await page.getByLabel("Teléfono").fill(`381555${phoneDigits}`);
    await page.getByLabel("Email").fill(`cliente-e2e-comprar-ahora-${contactSuffix}@example.com`);
    await page.getByRole("radio", { name: "Reservar y pagar al retirar" }).check();
    await page.getByRole("button", { name: "Confirmar pedido" }).click();

    await expect(page.getByText(/Pedido confirmado/)).toBeVisible();
    await expect(page.getByText(/DOM-/)).toBeVisible();

    // 6. Product A's cart line is STILL there after the buy-now order
    // completes (the owner-confirmed requirement this whole feature backs).
    await page.goto("/carrito");
    await expect(page.getByText(productAName)).toBeVisible();
    await expect(page.getByText("Talle M")).toBeVisible();
    await expect(page.getByRole("link", { name: "Carrito, 1 artículos" })).toBeVisible();
  });
});
