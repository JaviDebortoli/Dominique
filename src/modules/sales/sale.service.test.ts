import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import { hold, OutOfStockError } from "@/modules/inventory/stock.service";
import {
  recordInStoreSale,
  SaleAlreadyVoidedError,
  SaleNotFoundError,
  SaleVoidWindowClosedError,
  voidSale,
} from "./sale.service";

// Integration tests against the real local Postgres (design.md Testing
// Strategy: "no mocked Prisma" — recordInStoreSale()'s one-transaction
// atomicity between Sale and StockMovement is a DB-transaction guarantee).
// Backs specs/sales-revenue/spec.md "In-Person Sale Recording" and
// openspec/changes/control-de-caja/tasks.md 2.1/2.2.
describe("sale.service — recordInStoreSale() (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.sale.deleteMany({ where: { variant: { productId: { in: createdProductIds } } } });
    await prisma.stockMovement.deleteMany({
      where: { variant: { productId: { in: createdProductIds } } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makeVariant(onHand: number, price = 20000, priceOverride?: number) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Sale Test ${suffix}`, slug: `sale-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Producto Sale ${suffix}`,
      slug: `producto-sale-${suffix}`,
      price,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `SALE-${suffix}`, onHand, priceOverride }],
    });
    createdProductIds.push(product.id);
    return product.variants[0];
  }

  it("creates one Sale row (unitPrice resolved from product price) and the existing StockMovement(IN_STORE_SALE) in one transaction", async () => {
    const variant = await makeVariant(5, 15000);

    const sale = await recordInStoreSale(prisma, {
      variantId: variant.id,
      qty: 1,
      paymentMethod: "CASH",
    });

    expect(sale.paymentMethod).toBe("CASH");
    expect(Number(sale.unitPrice)).toBe(15000);
    expect(sale.qty).toBe(1);
    expect(sale.voidedAt).toBeNull();

    const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updatedVariant.onHand).toBe(4);

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { variantId: variant.id, reason: "IN_STORE_SALE" },
    });
    expect(movement.delta).toBe(-1);
  });

  it("triangulation: resolves unitPrice from variant.priceOverride when present, not the product price", async () => {
    const variant = await makeVariant(3, 15000, 22000);

    const sale = await recordInStoreSale(prisma, {
      variantId: variant.id,
      qty: 1,
      paymentMethod: "TRANSFER",
    });

    expect(Number(sale.unitPrice)).toBe(22000);
    expect(sale.paymentMethod).toBe("TRANSFER");
  });

  it("OutOfStockError rolls back both writes — zero Sale rows and stock unchanged after failure", async () => {
    const variant = await makeVariant(1);
    await hold(prisma, { variantId: variant.id, qty: 1 }); // fully reserved, unsellable in-store

    await expect(
      recordInStoreSale(prisma, { variantId: variant.id, qty: 1, paymentMethod: "CASH" }),
    ).rejects.toThrow(OutOfStockError);

    const salesForVariant = await prisma.sale.findMany({ where: { variantId: variant.id } });
    expect(salesForVariant).toHaveLength(0);

    const unchanged = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(unchanged.onHand).toBe(1);
  });
});

// control-de-caja tasks.md Phase 3 — voidSale() (specs/sales-revenue/spec.md
// "Sale Voiding (Anular)", design.md D2/diagram (b)). Same-caja-day void
// window, owner-confirmed (design.md's Open Questions: "Confirmed by
// owner").
describe("sale.service — voidSale() (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.sale.deleteMany({ where: { variant: { productId: { in: createdProductIds } } } });
    await prisma.stockMovement.deleteMany({
      where: { variant: { productId: { in: createdProductIds } } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makeVariant(onHand: number, price = 20000) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Void Test ${suffix}`, slug: `void-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Producto Void ${suffix}`,
      slug: `producto-void-${suffix}`,
      price,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `VOID-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);
    return product.variants[0];
  }

  async function makeSale(variantId: string, qty: number, soldAt?: Date) {
    return prisma.sale.create({
      data: {
        variantId,
        qty,
        unitPrice: 20000,
        paymentMethod: "CASH",
        ...(soldAt ? { soldAt } : {}),
      },
    });
  }

  it("restocks exactly +qty once and excludes the sale from future report queries (voidedAt set)", async () => {
    const variant = await makeVariant(5);
    const sale = await recordInStoreSale(prisma, {
      variantId: variant.id,
      qty: 2,
      paymentMethod: "CASH",
    });
    const afterSale = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(afterSale.onHand).toBe(3);

    const voided = await voidSale(prisma, { saleId: sale.id });

    expect(voided.voidedAt).not.toBeNull();
    const restocked = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(restocked.onHand).toBe(5);
    const readBack = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(readBack.voidedAt).not.toBeNull();
  });

  it("second voidSale() call on the same sale throws SaleAlreadyVoidedError, no second restock", async () => {
    const variant = await makeVariant(4);
    const sale = await recordInStoreSale(prisma, {
      variantId: variant.id,
      qty: 1,
      paymentMethod: "CASH",
    });
    await voidSale(prisma, { saleId: sale.id });

    await expect(voidSale(prisma, { saleId: sale.id })).rejects.toThrow(SaleAlreadyVoidedError);

    const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updated.onHand).toBe(4); // 4 - 1 (sale) + 1 (single void) = 4, never restocked twice
  });

  it("throws SaleNotFoundError for an unknown saleId", async () => {
    await expect(voidSale(prisma, { saleId: `nope-${randomUUID()}` })).rejects.toThrow(
      SaleNotFoundError,
    );
  });

  it("voiding a sale with soldAt = yesterday throws SaleVoidWindowClosedError, no restock (same-caja-day window)", async () => {
    const variant = await makeVariant(3);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sale = await makeSale(variant.id, 1, yesterday);

    await expect(voidSale(prisma, { saleId: sale.id })).rejects.toThrow(
      SaleVoidWindowClosedError,
    );

    const unchanged = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(unchanged.onHand).toBe(3);
    const readBack = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(readBack.voidedAt).toBeNull();
  });

  it("concurrent double-void: exactly one 200-equivalent success, one rejection, restock applied once", async () => {
    const variant = await makeVariant(6);
    const sale = await recordInStoreSale(prisma, {
      variantId: variant.id,
      qty: 3,
      paymentMethod: "CASH",
    });

    const results = await Promise.allSettled([
      voidSale(prisma, { saleId: sale.id }),
      voidSale(prisma, { saleId: sale.id }),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(SaleAlreadyVoidedError);

    const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updated.onHand).toBe(6); // 6 - 3 (sale) + 3 (exactly one restock) = 6
  });
});
