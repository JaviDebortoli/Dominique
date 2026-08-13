import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import {
  adjust,
  commitPaid,
  hold,
  InvalidStockAdjustmentError,
  OutOfStockError,
  release,
  sellInStore,
} from "./stock.service";

// Integration tests against the real local Postgres (design.md Testing
// Strategy: "no mocked Prisma"; D3's conditional UPDATE is a DB-level
// guarantee and cannot be meaningfully proven with a mocked client).
// Backs specs/inventory-stock/spec.md:
//   - "Reservations Decrement Available Stock Without Marking Sold"
//   - "Auto-Release Applies Only to Reserved-Unpaid Stock" (indirectly —
//     hold() is the only writer of `held` at checkout time)
// and design.md D3 (the single concurrency primitive).
describe("stock.service — hold() (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    // StockMovement.variantId has ON DELETE RESTRICT (audit ledger — never
    // cascade-delete history), so the movements hold() wrote must be
    // cleared before the product/variant cascade can run.
    await prisma.stockMovement.deleteMany({
      where: { variant: { productId: { in: createdProductIds } } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makeVariant(onHand: number) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Stock Test ${suffix}`, slug: `stock-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Producto Stock ${suffix}`,
      slug: `producto-stock-${suffix}`,
      price: 10000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `STK-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);

    return product.variants[0];
  }

  describe("hold() — conditional UPDATE decrements availability (D3)", () => {
    it("increments held and reduces available stock when enough stock exists", async () => {
      const variant = await makeVariant(5);

      await hold(prisma, { variantId: variant.id, qty: 2 });

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.held).toBe(2);
      expect(updated.onHand - updated.held).toBe(3);
    });

    it("throws OutOfStockError and leaves held unchanged when 0 rows match the conditional UPDATE", async () => {
      const variant = await makeVariant(1);

      await expect(hold(prisma, { variantId: variant.id, qty: 2 })).rejects.toThrow(
        OutOfStockError,
      );

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.held).toBe(0);
    });

    it("triangulation: a second hold() on the same variant is limited by what remains available", async () => {
      const variant = await makeVariant(3);

      await hold(prisma, { variantId: variant.id, qty: 2 });
      await expect(hold(prisma, { variantId: variant.id, qty: 2 })).rejects.toThrow(
        OutOfStockError,
      );
      await hold(prisma, { variantId: variant.id, qty: 1 });

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.held).toBe(3);
      expect(updated.onHand - updated.held).toBe(0);
    });
  });

  describe("hold() — concurrency (D3, the single most important correctness guarantee)", () => {
    it("exactly one of several parallel hold() calls succeeds on the last unit; the rest get OutOfStockError", async () => {
      const variant = await makeVariant(1);

      // Kept modest per infra guidance: the shared local `npx prisma dev`
      // proxy has proven fragile under heavy concurrent connections. 8
      // parallel attempts is still more than enough to prove row-level
      // atomicity (Postgres serializes concurrent UPDATEs on the same row
      // under READ COMMITTED; only one CAN see onHand-held >= qty).
      const CONCURRENCY = 8;
      const attempts = Array.from({ length: CONCURRENCY }, () =>
        hold(prisma, { variantId: variant.id, qty: 1 }),
      );

      const results = await Promise.allSettled(attempts);

      const succeeded = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(CONCURRENCY - 1);
      for (const failure of failed) {
        expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(OutOfStockError);
      }

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.held).toBe(1);
      expect(updated.onHand - updated.held).toBe(0);
    });
  });

  // tasks.md 5.4 — Atomic Stock Decrement HARD RULE (design.md
  // specs/payment-mercadopago "Atomic, Immediate Stock Decrement on
  // Confirmed Payment"): commitPaid() decrements BOTH onHand and held in
  // the same conditional UPDATE, so a variant paid for online is
  // immediately gone from onHand (never sellable in-store afterward) and
  // its `held` hold is released at the same time — never a two-step
  // "release then separately decrement onHand" that could interleave with
  // another writer.
  describe("commitPaid() — atomic onHand+held decrement on confirmed payment (D2/D3, HARD RULE)", () => {
    it("decrements onHand and held together, leaving available stock unchanged", async () => {
      const variant = await makeVariant(5);
      await hold(prisma, { variantId: variant.id, qty: 2 });

      await commitPaid(prisma, { variantId: variant.id, qty: 2 });

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.onHand).toBe(3);
      expect(updated.held).toBe(0);
    });

    it("throws OutOfStockError and changes nothing when there isn't enough onHand/held to commit", async () => {
      const variant = await makeVariant(1);
      await hold(prisma, { variantId: variant.id, qty: 1 });

      await expect(commitPaid(prisma, { variantId: variant.id, qty: 5 })).rejects.toThrow(
        OutOfStockError,
      );

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.onHand).toBe(1);
      expect(updated.held).toBe(1);
    });

    it("triangulation: a second variant with a different onHand/held combination commits correctly", async () => {
      const variant = await makeVariant(10);
      await hold(prisma, { variantId: variant.id, qty: 4 });

      await commitPaid(prisma, { variantId: variant.id, qty: 4 });

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.onHand).toBe(6);
      expect(updated.held).toBe(0);
    });
  });

  // tasks.md 5.5 — rejected/cancelled payments release the held stock
  // WITHOUT touching onHand (specs/payment-mercadopago "Payment rejected or
  // cancelled": "the system MUST NOT decrement stock").
  describe("release() — returns held stock without touching onHand (rejected/cancelled/expired)", () => {
    it("decrements held only, leaving onHand and total available stock restored", async () => {
      const variant = await makeVariant(5);
      await hold(prisma, { variantId: variant.id, qty: 3 });

      await release(prisma, { variantId: variant.id, qty: 3 });

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.onHand).toBe(5);
      expect(updated.held).toBe(0);
      expect(updated.onHand - updated.held).toBe(5);
    });

    it("throws OutOfStockError and changes nothing when trying to release more than is held", async () => {
      const variant = await makeVariant(2);
      await hold(prisma, { variantId: variant.id, qty: 1 });

      await expect(release(prisma, { variantId: variant.id, qty: 2 })).rejects.toThrow(
        OutOfStockError,
      );

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.held).toBe(1);
    });

    it("triangulation: a partial release leaves the remaining held amount intact", async () => {
      const variant = await makeVariant(6);
      await hold(prisma, { variantId: variant.id, qty: 4 });

      await release(prisma, { variantId: variant.id, qty: 1 });

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.held).toBe(3);
      expect(updated.onHand - updated.held).toBe(3);
    });
  });

  // tasks.md 7.7 — in-store sale decrements onHand via the SAME conditional
  // UPDATE primitive as hold()/commitPaid()/release() (design.md Sequence —
  // "in-store sale → /admin/caja 'Vender en local': onHand-=q via the same
  // conditional UPDATE + StockMovement(reason=IN_STORE_SALE)"). Reserved
  // (held) stock MUST NOT be sellable in person — a variant with 0 available
  // (fully held) must reject an in-store sale even though onHand > 0.
  describe("sellInStore() — decrements onHand for an in-person sale (D2/D3, tasks.md 7.7)", () => {
    it("decrements onHand only, leaving held and total availability accounting consistent", async () => {
      const variant = await makeVariant(5);

      await sellInStore(prisma, { variantId: variant.id, qty: 2 });

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.onHand).toBe(3);
      expect(updated.held).toBe(0);
    });

    it("records a StockMovement with reason IN_STORE_SALE", async () => {
      const variant = await makeVariant(5);

      await sellInStore(prisma, { variantId: variant.id, qty: 1 });

      const movement = await prisma.stockMovement.findFirstOrThrow({
        where: { variantId: variant.id, reason: "IN_STORE_SALE" },
      });
      expect(movement.delta).toBe(-1);
    });

    it("refuses to sell a held (reserved-unpaid) unit in-store, even though onHand alone would cover it", async () => {
      const variant = await makeVariant(2);
      await hold(prisma, { variantId: variant.id, qty: 2 }); // both units reserved-unpaid

      await expect(sellInStore(prisma, { variantId: variant.id, qty: 1 })).rejects.toThrow(
        OutOfStockError,
      );

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.onHand).toBe(2); // unchanged
    });

    it("HARD RULE proof: a variant just paid via MercadoPago (onHand already decremented) cannot be sold in-store", async () => {
      const variant = await makeVariant(1);
      await hold(prisma, { variantId: variant.id, qty: 1 });
      await commitPaid(prisma, { variantId: variant.id, qty: 1 }); // onHand now 0, held now 0

      await expect(sellInStore(prisma, { variantId: variant.id, qty: 1 })).rejects.toThrow(
        OutOfStockError,
      );
    });
  });

  // tasks.md 7.8 — manual admin reconciliation (specs/inventory-stock/spec.md
  // "Manual Admin Reconciliation"). Must never let onHand drop below held —
  // the same invariant hold()/commitPaid()/release() already protect.
  describe("adjust() — manual stock correction, positive or negative (tasks.md 7.8)", () => {
    it("increases onHand for a positive adjustment (e.g. restock/found units)", async () => {
      const variant = await makeVariant(3);

      await adjust(prisma, { variantId: variant.id, delta: 5 });

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.onHand).toBe(8);
    });

    it("decreases onHand for a negative adjustment (e.g. damage/miscount correction)", async () => {
      const variant = await makeVariant(5);

      await adjust(prisma, { variantId: variant.id, delta: -2 });

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.onHand).toBe(3);
    });

    it("records a StockMovement with reason ADJUSTMENT and the signed delta", async () => {
      const variant = await makeVariant(5);

      await adjust(prisma, { variantId: variant.id, delta: -3 });

      const movement = await prisma.stockMovement.findFirstOrThrow({
        where: { variantId: variant.id, reason: "ADJUSTMENT" },
      });
      expect(movement.delta).toBe(-3);
    });

    it("refuses a negative adjustment that would push onHand below held (protects the same invariant as hold())", async () => {
      const variant = await makeVariant(3);
      await hold(prisma, { variantId: variant.id, qty: 3 }); // fully reserved: onHand=3, held=3

      await expect(
        adjust(prisma, { variantId: variant.id, delta: -1 }),
      ).rejects.toThrow(InvalidStockAdjustmentError);

      const updated = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.onHand).toBe(3); // unchanged
    });

    it("refuses a negative adjustment that would push onHand below zero", async () => {
      const variant = await makeVariant(2);

      await expect(
        adjust(prisma, { variantId: variant.id, delta: -5 }),
      ).rejects.toThrow(InvalidStockAdjustmentError);
    });

    it("rejects a zero delta as a no-op error rather than silently succeeding", async () => {
      const variant = await makeVariant(2);

      await expect(adjust(prisma, { variantId: variant.id, delta: 0 })).rejects.toThrow(
        RangeError,
      );
    });

    it("applies immediately — reading the variant right after adjust() reflects the corrected value (spec: 'applies immediately across storefront and admin views')", async () => {
      const variant = await makeVariant(10);

      await adjust(prisma, { variantId: variant.id, delta: -4 });
      const readBack = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });

      expect(readBack.onHand - readBack.held).toBe(6);
    });
  });
});
