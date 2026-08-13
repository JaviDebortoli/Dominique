import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import { confirmPaymentApproved, createPendingOrder } from "@/modules/orders/order.service";
import { getCajaRows } from "./caja.service";

// Integration tests against the real local Postgres (design.md Testing
// Strategy: "no mocked Prisma").
// Backs specs/admin-console/spec.md "Real-Time-Accurate Stock View Before
// In-Person Sale (HARD RULE)" and specs/inventory-stock/spec.md "Distinct
// Stock States" ("State breakdown visible": 5 available -> 1 reserved
// (unpaid) + 1 sold via confirmed MercadoPago -> 3 available, 1
// reserved-unpaid, 1 sold-paid). tasks.md 7.6/7.10.
describe("caja.service — getCajaRows() (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdOrderIds: string[] = [];

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.stockMovement.deleteMany({
      where: { variant: { productId: { in: createdProductIds } } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makeVariant(onHand: number) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Caja Test ${suffix}`, slug: `caja-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Producto Caja ${suffix}`,
      slug: `producto-caja-${suffix}`,
      price: 20000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `CAJA-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);

    return { product, variant: product.variants[0] };
  }

  function findRow(rows: Awaited<ReturnType<typeof getCajaRows>>, variantId: string) {
    const row = rows.find((r) => r.variantId === variantId);
    if (!row) throw new Error(`no caja row for variant ${variantId}`);
    return row;
  }

  it("matches inventory-stock spec's 'State breakdown visible' scenario exactly: 5 onHand -> 1 reserved-unpaid + 1 sold-paid -> 3/1/1", async () => {
    const { variant } = await makeVariant(5);

    const reservation = await createPendingOrder(prisma, {
      buyerName: "Compradora Reserva",
      phone: "3815550001",
      email: "reserva@example.com",
      method: "PICKUP_CASH",
      items: [{ variantId: variant.id, qty: 1 }],
    });
    createdOrderIds.push(reservation.id);

    const paidOrder = await createPendingOrder(prisma, {
      buyerName: "Compradora Pagada",
      phone: "3815550002",
      email: "pagada@example.com",
      method: "MP",
      items: [{ variantId: variant.id, qty: 1 }],
    });
    createdOrderIds.push(paidOrder.id);
    await confirmPaymentApproved(prisma, {
      orderId: paidOrder.id,
      mpPaymentId: `caja-test-${randomUUID()}`,
      amount: 20000,
      rawPayload: { status: "approved" },
    });

    const rows = await getCajaRows(prisma);
    const row = findRow(rows, variant.id);

    expect(row.disponible).toBe(3);
    expect(row.reservado).toBe(1);
    expect(row.enDeposito).toBe(1);
  });

  it("lists buyer name and expiry on a reserved-unpaid row (so staff never hand over held stock)", async () => {
    const { variant } = await makeVariant(2);

    const reservation = await createPendingOrder(prisma, {
      buyerName: "Juana Pérez",
      phone: "3815550003",
      email: "juana@example.com",
      method: "PICKUP_CASH",
      items: [{ variantId: variant.id, qty: 1 }],
    });
    createdOrderIds.push(reservation.id);

    const rows = await getCajaRows(prisma);
    const row = findRow(rows, variant.id);

    expect(row.reservations).toHaveLength(1);
    expect(row.reservations[0]?.buyerName).toBe("Juana Pérez");
    expect(row.reservations[0]?.expiresAt).not.toBeNull();
  });

  it("HARD RULE: a variant paid via MercadoPago moments ago already shows the reduced disponible count", async () => {
    const { variant } = await makeVariant(1);

    const order = await createPendingOrder(prisma, {
      buyerName: "Compradora Instantanea",
      phone: "3815550004",
      email: "instant@example.com",
      method: "MP",
      items: [{ variantId: variant.id, qty: 1 }],
    });
    createdOrderIds.push(order.id);
    await confirmPaymentApproved(prisma, {
      orderId: order.id,
      mpPaymentId: `caja-hard-rule-${randomUUID()}`,
      amount: 20000,
      rawPayload: { status: "approved" },
    });

    const rows = await getCajaRows(prisma);
    const row = findRow(rows, variant.id);

    expect(row.disponible).toBe(0);
    expect(row.reservado).toBe(0);
    expect(row.enDeposito).toBe(1);
  });

  it("a variant with no orders shows full onHand as disponible and zero elsewhere", async () => {
    const { variant } = await makeVariant(4);

    const rows = await getCajaRows(prisma);
    const row = findRow(rows, variant.id);

    expect(row.disponible).toBe(4);
    expect(row.reservado).toBe(0);
    expect(row.enDeposito).toBe(0);
    expect(row.reservations).toHaveLength(0);
  });

  it("filters rows by product name or SKU search", async () => {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Caja Search ${suffix}`, slug: `caja-search-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    const product = await createProduct(prisma, {
      name: `Buscable Unico ${suffix}`,
      slug: `buscable-${suffix}`,
      price: 5000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `SEARCHSKU-${suffix}`, onHand: 1 }],
    });
    createdProductIds.push(product.id);

    const rows = await getCajaRows(prisma, { search: `Buscable Unico ${suffix}` });

    expect(rows.some((row) => row.variantId === product.variants[0]!.id)).toBe(true);
    expect(rows.every((row) => row.productName.includes("Buscable"))).toBe(true);
  });
});
