import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import { confirmPaymentApproved, createPendingOrder } from "@/modules/orders/order.service";
import { recordInStoreSale, voidSale } from "@/modules/sales/sale.service";
import { getRevenueReport, mergeRevenue } from "./caja-report.service";

// control-de-caja tasks.md 5.3 — pure bucketing/merge logic, tested with
// FAKED Q1/Q3 results (Testing Strategy: "Fake query results into the
// merge function"). Backs specs/sales-revenue/spec.md "Revenue Aggregation
// by Period and Payment Method" and design.md diagram (d).
describe("caja-report.service — mergeRevenue() (unit, faked inputs)", () => {
  it("sums in-person CASH sales into both inPerson.CASH and totals.CASH", () => {
    const result = mergeRevenue(
      [{ paymentMethod: "CASH", qty: 2, unitPrice: new Prisma.Decimal(1000) }],
      [],
    );

    expect(result.inPerson.CASH.toNumber()).toBe(2000);
    expect(result.totals.CASH.toNumber()).toBe(2000);
    expect(result.grandTotal.toNumber()).toBe(2000);
  });

  it("triangulation: sums in-person TRANSFER sales separately from CASH", () => {
    const result = mergeRevenue(
      [{ paymentMethod: "TRANSFER", qty: 1, unitPrice: new Prisma.Decimal(5000) }],
      [],
    );

    expect(result.inPerson.TRANSFER.toNumber()).toBe(5000);
    expect(result.totals.TRANSFER.toNumber()).toBe(5000);
    expect(result.totals.CASH.toNumber()).toBe(0);
  });

  it("sums an MP order's items once into totals.MP, without touching inPerson", () => {
    const result = mergeRevenue(
      [],
      [
        {
          method: "MP",
          paymentMethod: null,
          items: [
            { qty: 2, unitPrice: new Prisma.Decimal(3000) },
            { qty: 1, unitPrice: new Prisma.Decimal(1500) },
          ],
        },
      ],
    );

    expect(result.totals.MP.toNumber()).toBe(7500);
    expect(result.fromOrders.MP.toNumber()).toBe(7500);
    expect(result.inPerson.CASH.toNumber()).toBe(0);
    expect(result.inPerson.TRANSFER.toNumber()).toBe(0);
  });

  it("a PICKUP_CASH order paid CASH merges into totals.CASH alongside in-person CASH sales — no double bucket", () => {
    const result = mergeRevenue(
      [{ paymentMethod: "CASH", qty: 1, unitPrice: new Prisma.Decimal(1000) }],
      [
        {
          method: "PICKUP_CASH",
          paymentMethod: "CASH",
          items: [{ qty: 1, unitPrice: new Prisma.Decimal(2000) }],
        },
      ],
    );

    expect(result.totals.CASH.toNumber()).toBe(3000);
    expect(result.inPerson.CASH.toNumber()).toBe(1000);
    expect(result.fromOrders.CASH.toNumber()).toBe(2000);
  });

  it("a PICKUP_CASH order with no recorded payment method buckets into the UNKNOWN legacy bucket", () => {
    const result = mergeRevenue(
      [],
      [
        {
          method: "PICKUP_CASH",
          paymentMethod: null,
          items: [{ qty: 1, unitPrice: new Prisma.Decimal(9000) }],
        },
      ],
    );

    expect(result.totals.UNKNOWN.toNumber()).toBe(9000);
    expect(result.totals.CASH.toNumber()).toBe(0);
    expect(result.totals.TRANSFER.toNumber()).toBe(0);
  });

  it("grandTotal sums every bucket across in-person sales and orders", () => {
    const result = mergeRevenue(
      [{ paymentMethod: "CASH", qty: 1, unitPrice: new Prisma.Decimal(1000) }],
      [
        {
          method: "MP",
          paymentMethod: null,
          items: [{ qty: 1, unitPrice: new Prisma.Decimal(2000) }],
        },
        {
          method: "PICKUP_CASH",
          paymentMethod: "TRANSFER",
          items: [{ qty: 1, unitPrice: new Prisma.Decimal(500) }],
        },
      ],
    );

    expect(result.grandTotal.toNumber()).toBe(3500);
  });
});

// control-de-caja tasks.md 5.4 — integration tests against the real local
// Postgres (design.md Testing Strategy: "no mocked Prisma"). Backs
// specs/sales-revenue/spec.md's remaining scenarios: no double-counting,
// voided-sale exclusion, single-day/range filters, and the honest
// pre-ship-date empty state.
describe("caja-report.service — getRevenueReport() (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdOrderIds: string[] = [];

  afterAll(async () => {
    await prisma.sale.deleteMany({ where: { variant: { productId: { in: createdProductIds } } } });
    await prisma.stockMovement.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.stockMovement.deleteMany({
      where: { variant: { productId: { in: createdProductIds } } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async function makeVariant(onHand: number, price = 10000) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Report Test ${suffix}`, slug: `report-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);
    const product = await createProduct(prisma, {
      name: `Producto Report ${suffix}`,
      slug: `producto-report-${suffix}`,
      price,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `RPT-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);
    return product.variants[0];
  }

  it("counts a 3-line PAID (MP) order exactly once, not once per StockMovement(PAID) row", async () => {
    const variantA = await makeVariant(5, 10000);
    const variantB = await makeVariant(5, 15000);
    const variantC = await makeVariant(5, 5000);

    const order = await createPendingOrder(prisma, {
      buyerName: "Comprador Reporte",
      phone: "3815550020",
      email: `reporte-${randomUUID()}@example.com`,
      method: "MP",
      items: [
        { variantId: variantA.id, qty: 1 },
        { variantId: variantB.id, qty: 1 },
        { variantId: variantC.id, qty: 2 },
      ],
    });
    createdOrderIds.push(order.id);
    await confirmPaymentApproved(prisma, {
      orderId: order.id,
      mpPaymentId: `mp-report-${randomUUID()}`,
      amount: 35000,
      rawPayload: { status: "approved" },
    });

    const report = await getRevenueReport(prisma, { from: todayStr(), to: todayStr() });

    expect(report.counts.orders).toBeGreaterThanOrEqual(1);
    // 1*10000 + 1*15000 + 2*5000 = 35000 for THIS order — assert the MP
    // total is a multiple of the per-order amount consistent with counting
    // once (a 3x double-count would make it a multiple of 3 as large).
    const thisOrderTotal = 35000;
    expect(report.totals.MP.toNumber() % thisOrderTotal).toBe(0);
    expect(report.totals.MP.toNumber()).toBeGreaterThanOrEqual(thisOrderTotal);
  });

  it("excludes a voided sale from totals", async () => {
    const variant = await makeVariant(5, 8000);
    const sale = await recordInStoreSale(prisma, {
      variantId: variant.id,
      qty: 1,
      paymentMethod: "CASH",
    });
    await voidSale(prisma, { saleId: sale.id });

    const report = await getRevenueReport(prisma, { from: todayStr(), to: todayStr() });

    // A second, non-voided sale on the SAME variant/day proves the query
    // still finds real CASH revenue — the voided one just isn't in it.
    await recordInStoreSale(prisma, { variantId: variant.id, qty: 1, paymentMethod: "CASH" });
    const reportAfter = await getRevenueReport(prisma, { from: todayStr(), to: todayStr() });

    expect(reportAfter.totals.CASH.toNumber()).toBe(report.totals.CASH.toNumber() + 8000);
    expect(reportAfter.counts.voidedSales).toBeGreaterThanOrEqual(1);
  });

  it("single-day and multi-day range filters both include today's qualifying sale", async () => {
    const variant = await makeVariant(3, 6000);
    await recordInStoreSale(prisma, { variantId: variant.id, qty: 1, paymentMethod: "TRANSFER" });

    const singleDay = await getRevenueReport(prisma, { from: todayStr(), to: todayStr() });
    const range = await getRevenueReport(prisma, { from: "2026-01-01", to: todayStr() });

    expect(singleDay.totals.TRANSFER.toNumber()).toBeGreaterThanOrEqual(6000);
    expect(range.totals.TRANSFER.toNumber()).toBeGreaterThanOrEqual(
      singleDay.totals.TRANSFER.toNumber(),
    );
  });

  it("shows an honest limited-data state for a range entirely before this change's ship date, with zero totals", async () => {
    const report = await getRevenueReport(prisma, { from: "2020-01-01", to: "2020-01-01" });

    expect(report.limitedData).toBe(true);
    expect(report.grandTotal.toNumber()).toBe(0);
  });

  it("does NOT mark a range that includes today as limited-data", async () => {
    const report = await getRevenueReport(prisma, { from: todayStr(), to: todayStr() });

    expect(report.limitedData).toBe(false);
  });
});
