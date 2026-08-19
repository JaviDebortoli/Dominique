import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import { hold, OutOfStockError } from "@/modules/inventory/stock.service";
import { nextOpenBusinessDayClose } from "@/lib/business-days";
import {
  cancelOrder,
  confirmPaymentApproved,
  confirmPaymentPending,
  confirmPaymentRejectedOrCancelled,
  createPendingOrder,
  EmptyCartError,
  InvalidOrderStatusTransitionError,
  markPickedUp,
  OrderNotFoundError,
  StockUnavailableError,
} from "./order.service";

// Integration tests against the real local Postgres (design.md Testing
// Strategy: "no mocked Prisma" — order creation + hold() atomicity is a
// DB-transaction guarantee).
// Backs:
//   - specs/cart-checkout/spec.md "Stock Re-Validation at Submission"
//   - design.md D5 (30-min PENDING_PAYMENT hold) and the Sequence — Stock &
//     Reservation diagram ("checkout: hold(q) ... 0 rows -> 409")
//   - tasks.md 4.5/4.6
describe("order.service — createPendingOrder (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdOrderIds: string[] = [];

  afterAll(async () => {
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

  async function makeProductWithVariant(onHand: number, price = 20000) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Checkout Test ${suffix}`, slug: `checkout-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Producto Checkout ${suffix}`,
      slug: `producto-checkout-${suffix}`,
      price,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `CHK-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);

    return { product, variant: product.variants[0] };
  }

  function guestContact() {
    return { buyerName: "Guest Buyer", phone: "3815551234", email: "guest@example.com" };
  }

  describe("D5 — creates Order(PENDING_PAYMENT, expiresAt=+30min) and holds every line in one tx", () => {
    it("creates the order, sets expiresAt ~30 minutes out, and increments held for every line", async () => {
      const { variant } = await makeProductWithVariant(5, 20000);
      const before = Date.now();

      const order = await createPendingOrder(prisma, {
        ...guestContact(),
        method: "MP",
        items: [{ variantId: variant.id, qty: 2 }],
      });
      createdOrderIds.push(order.id);

      expect(order.status).toBe("PENDING_PAYMENT");
      expect(order.buyerName).toBe("Guest Buyer");
      expect(order.method).toBe("MP");
      expect(order.expiresAt).not.toBeNull();
      const expiresInMinutes = (order.expiresAt!.getTime() - before) / 60_000;
      expect(expiresInMinutes).toBeGreaterThan(29);
      expect(expiresInMinutes).toBeLessThan(31);

      expect(order.items).toHaveLength(1);
      expect(order.items[0].qty).toBe(2);
      expect(Number(order.items[0].unitPrice)).toBe(20000);

      const updatedVariant = await prisma.variant.findUniqueOrThrow({
        where: { id: variant.id },
      });
      expect(updatedVariant.held).toBe(2);
      expect(updatedVariant.onHand - updatedVariant.held).toBe(3);
    });

    it("triangulation: holds every line across multiple variants in the same order", async () => {
      const { variant: variantA } = await makeProductWithVariant(3, 10000);
      const { variant: variantB } = await makeProductWithVariant(2, 15000);

      const order = await createPendingOrder(prisma, {
        ...guestContact(),
        method: "PICKUP_CASH",
        items: [
          { variantId: variantA.id, qty: 1 },
          { variantId: variantB.id, qty: 2 },
        ],
      });
      createdOrderIds.push(order.id);

      expect(order.items).toHaveLength(2);
      const updatedA = await prisma.variant.findUniqueOrThrow({ where: { id: variantA.id } });
      const updatedB = await prisma.variant.findUniqueOrThrow({ where: { id: variantB.id } });
      expect(updatedA.held).toBe(1);
      expect(updatedB.held).toBe(2);
    });
  });

  describe("Stock Re-Validation at Submission — rejects unavailable lines, all-or-nothing", () => {
    it("rejects the whole submission when a line no longer has enough stock, and does NOT create the order or hold anything", async () => {
      const { variant } = await makeProductWithVariant(1, 20000);

      // Simulate "another order consumed the unit before this customer
      // submitted checkout" (spec scenario) by holding it out-of-band first.
      await hold(prisma, { variantId: variant.id, qty: 1 });

      await expect(
        createPendingOrder(prisma, {
          ...guestContact(),
          method: "MP",
          items: [{ variantId: variant.id, qty: 1 }],
        }),
      ).rejects.toThrow(StockUnavailableError);

      const ordersForVariant = await prisma.orderItem.findMany({ where: { variantId: variant.id } });
      expect(ordersForVariant).toHaveLength(0);

      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      // Held stays at exactly the 1 unit from the out-of-band hold above —
      // the rejected checkout attempt must not have added anything.
      expect(updatedVariant.held).toBe(1);
    });

    it("rejects and creates nothing when the cart is empty", async () => {
      await expect(
        createPendingOrder(prisma, { ...guestContact(), method: "MP", items: [] }),
      ).rejects.toThrow(EmptyCartError);
    });

    it("all-or-nothing: one available line + one unavailable line ⇒ the available line is NOT held either", async () => {
      const { variant: available } = await makeProductWithVariant(5, 20000);
      const { variant: unavailable } = await makeProductWithVariant(0, 15000);

      await expect(
        createPendingOrder(prisma, {
          ...guestContact(),
          method: "MP",
          items: [
            { variantId: available.id, qty: 1 },
            { variantId: unavailable.id, qty: 1 },
          ],
        }),
      ).rejects.toThrow(StockUnavailableError);

      const updatedAvailable = await prisma.variant.findUniqueOrThrow({ where: { id: available.id } });
      expect(updatedAvailable.held).toBe(0);
    });
  });

  describe("Race safety: the transactional hold() inside createPendingOrder is the source of truth, not just the pre-check", () => {
    it("when two checkouts race for the last unit, exactly one order is created and the other fails with OutOfStockError or StockUnavailableError", async () => {
      const { variant } = await makeProductWithVariant(1, 20000);

      // Two independent PrismaClient connections (not the shared `prisma`
      // singleton) so each concurrent interactive transaction gets its own
      // connection-pool/prepared-statement cache. Sharing one client's pool
      // across two simultaneous `$transaction()` calls trips a known
      // local-dev-proxy quirk in `npx prisma dev` (bind message / prepared
      // statement cross-talk on overlapping connections — the same class of
      // issue vitest.config.mts documents for parallel test files); real
      // Postgres in staging/production does not have this limitation, and
      // stock.service.test.ts's dedicated 8-way concurrency test (task 4.2,
      // the primary correctness guarantee for D3) already proves atomicity
      // at the raw hold() layer without hitting it.
      const clientA = new PrismaClient({
        adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
      });
      const clientB = new PrismaClient({
        adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
      });

      const attempt = (client: PrismaClient) =>
        createPendingOrder(client, {
          ...guestContact(),
          method: "MP",
          items: [{ variantId: variant.id, qty: 1 }],
        });

      try {
        const results = await Promise.allSettled([attempt(clientA), attempt(clientB)]);
        const succeeded = results.filter(
          (r) => r.status === "fulfilled",
        ) as PromiseFulfilledResult<Awaited<ReturnType<typeof attempt>>>[];
        const failed = results.filter((r) => r.status === "rejected");

        expect(succeeded).toHaveLength(1);
        expect(failed).toHaveLength(1);
        createdOrderIds.push(succeeded[0].value.id);

        const rejection = (failed[0] as PromiseRejectedResult).reason;
        expect(
          rejection instanceof StockUnavailableError || rejection instanceof OutOfStockError,
        ).toBe(true);

        const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
        expect(updatedVariant.held).toBe(1);
      } finally {
        await clientA.$disconnect();
        await clientB.$disconnect();
      }
    });
  });

  // tasks.md 5.4-5.7 — the webhook-facing lifecycle transitions
  // (specs/payment-mercadopago/spec.md + specs/order-lifecycle/spec.md).
  // These call the order.service functions directly (mpClient/signature
  // concerns are webhook.service.ts's job — see its own test file); this
  // suite proves the DB-transaction-level state-machine and D4 idempotency
  // guarantees against real Postgres.
  describe("confirmPaymentApproved/Rejected/Pending — webhook-facing lifecycle (tasks 5.4-5.7)", () => {
    async function makePendingOrder(onHand: number, qty = 1) {
      const { variant } = await makeProductWithVariant(onHand, 20000);
      const order = await createPendingOrder(prisma, {
        ...guestContact(),
        method: "MP",
        items: [{ variantId: variant.id, qty }],
      });
      createdOrderIds.push(order.id);
      return { variant, order };
    }

    describe("confirmPaymentApproved — Atomic Stock Decrement HARD RULE (task 5.4)", () => {
      it("commits the order to PAID and decrements onHand+held for every line, in one transaction", async () => {
        const { variant, order } = await makePendingOrder(5, 2);

        const result = await confirmPaymentApproved(prisma, {
          orderId: order.id,
          mpPaymentId: `mp-approved-${randomUUID()}`,
          amount: 40000,
          rawPayload: { status: "approved" },
        });

        expect(result.duplicate).toBe(false);
        expect(result.order.status).toBe("PAID");
        expect(result.order.expiresAt).toBeNull();

        const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
        expect(updatedVariant.onHand).toBe(3);
        expect(updatedVariant.held).toBe(0);
      });

      it("triangulation: a multi-line order commits every line's stock, not just the first", async () => {
        const { variant: variantA } = await makeProductWithVariant(4, 10000);
        const { variant: variantB } = await makeProductWithVariant(3, 12000);
        const order = await createPendingOrder(prisma, {
          ...guestContact(),
          method: "MP",
          items: [
            { variantId: variantA.id, qty: 2 },
            { variantId: variantB.id, qty: 1 },
          ],
        });
        createdOrderIds.push(order.id);

        const result = await confirmPaymentApproved(prisma, {
          orderId: order.id,
          mpPaymentId: `mp-approved-multi-${randomUUID()}`,
          amount: 32000,
          rawPayload: { status: "approved" },
        });

        expect(result.order.status).toBe("PAID");
        const updatedA = await prisma.variant.findUniqueOrThrow({ where: { id: variantA.id } });
        const updatedB = await prisma.variant.findUniqueOrThrow({ where: { id: variantB.id } });
        expect(updatedA.onHand).toBe(2);
        expect(updatedA.held).toBe(0);
        expect(updatedB.onHand).toBe(2);
        expect(updatedB.held).toBe(0);
      });

      it("throws OrderNotFoundError for an unknown orderId", async () => {
        await expect(
          confirmPaymentApproved(prisma, {
            orderId: `nope-${randomUUID()}`,
            mpPaymentId: `mp-${randomUUID()}`,
            amount: 1000,
            rawPayload: {},
          }),
        ).rejects.toThrow(OrderNotFoundError);
      });
    });

    describe("confirmPaymentRejectedOrCancelled — releases held stock, no onHand decrement (task 5.5)", () => {
      it("releases the held stock and marks the order CANCELLED, leaving onHand untouched", async () => {
        const { variant, order } = await makePendingOrder(5, 2);

        const result = await confirmPaymentRejectedOrCancelled(prisma, {
          orderId: order.id,
          mpPaymentId: `mp-rejected-${randomUUID()}`,
          amount: 40000,
          rawPayload: { status: "rejected" },
        });

        expect(result.duplicate).toBe(false);
        expect(result.order.status).toBe("CANCELLED");

        const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
        expect(updatedVariant.onHand).toBe(5);
        expect(updatedVariant.held).toBe(0);
      });

      it("triangulation: a cancelled (not rejected) status also releases and cancels identically", async () => {
        const { variant, order } = await makePendingOrder(3, 1);

        const result = await confirmPaymentRejectedOrCancelled(prisma, {
          orderId: order.id,
          mpPaymentId: `mp-cancelled-${randomUUID()}`,
          amount: 20000,
          rawPayload: { status: "cancelled" },
        });

        expect(result.order.status).toBe("CANCELLED");
        const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
        expect(updatedVariant.held).toBe(0);
      });

      it("never cancels an already-PAID order (out-of-order webhook safety)", async () => {
        const { variant, order } = await makePendingOrder(4, 1);
        await confirmPaymentApproved(prisma, {
          orderId: order.id,
          mpPaymentId: `mp-approved-first-${randomUUID()}`,
          amount: 20000,
          rawPayload: { status: "approved" },
        });

        // A late/out-of-order "rejected" notification for the same order
        // (design.md D4: "MercadoPago retries and may deliver out of
        // order") must NOT undo a payment that already succeeded.
        const result = await confirmPaymentRejectedOrCancelled(prisma, {
          orderId: order.id,
          mpPaymentId: `mp-rejected-late-${randomUUID()}`,
          amount: 20000,
          rawPayload: { status: "rejected" },
        });

        expect(result.order.status).toBe("PAID");
        const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
        expect(updatedVariant.onHand).toBe(3);
        expect(updatedVariant.held).toBe(0);
      });
    });

    describe("confirmPaymentPending — extends expiresAt to +3d, stays PENDING_PAYMENT, no decrement (task 5.6)", () => {
      it("extends expiresAt to ~3 days out and keeps the order PENDING_PAYMENT with stock still held", async () => {
        const { variant, order } = await makePendingOrder(4, 2);
        const before = Date.now();

        const result = await confirmPaymentPending(prisma, {
          orderId: order.id,
          mpPaymentId: `mp-pending-${randomUUID()}`,
          amount: 40000,
          rawPayload: { status: "pending" },
        });

        expect(result.duplicate).toBe(false);
        expect(result.order.status).toBe("PENDING_PAYMENT");
        const expiresInDays = (result.order.expiresAt!.getTime() - before) / (24 * 60 * 60 * 1000);
        expect(expiresInDays).toBeGreaterThan(2.9);
        expect(expiresInDays).toBeLessThan(3.1);

        const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
        expect(updatedVariant.onHand).toBe(4);
        expect(updatedVariant.held).toBe(2);
      });
    });

    describe("Idempotent Webhook Processing (task 5.7, D4) — duplicate mpPaymentId is a no-op, no double decrement", () => {
      it("a second approved webhook with the same mpPaymentId does not decrement stock again", async () => {
        const { variant, order } = await makePendingOrder(5, 2);
        const mpPaymentId = `mp-dup-${randomUUID()}`;

        const first = await confirmPaymentApproved(prisma, {
          orderId: order.id,
          mpPaymentId,
          amount: 40000,
          rawPayload: { status: "approved" },
        });
        expect(first.duplicate).toBe(false);

        const second = await confirmPaymentApproved(prisma, {
          orderId: order.id,
          mpPaymentId,
          amount: 40000,
          rawPayload: { status: "approved" },
        });
        expect(second.duplicate).toBe(true);
        expect(second.order.status).toBe("PAID");

        const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
        // Still exactly ONE decrement's worth — proves the unique
        // constraint (not just an app-level status check) is what stops
        // the second delivery from mutating stock a second time.
        expect(updatedVariant.onHand).toBe(3);
        expect(updatedVariant.held).toBe(0);

        const payments = await prisma.payment.findMany({ where: { mpPaymentId } });
        expect(payments).toHaveLength(1);
      });

      it("triangulation: three sequential duplicate deliveries still result in exactly one Payment row and one decrement", async () => {
        const { variant, order } = await makePendingOrder(3, 1);
        const mpPaymentId = `mp-dup-triple-${randomUUID()}`;

        for (let attempt = 0; attempt < 3; attempt++) {
          await confirmPaymentApproved(prisma, {
            orderId: order.id,
            mpPaymentId,
            amount: 20000,
            rawPayload: { status: "approved" },
          });
        }

        const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
        expect(updatedVariant.onHand).toBe(2);
        expect(updatedVariant.held).toBe(0);

        const payments = await prisma.payment.findMany({ where: { mpPaymentId } });
        expect(payments).toHaveLength(1);
      });
    });
  });

  // tasks.md 6.2/6.3 — pickup (cash/transfer-at-pickup) reservation path.
  // Backs specs/pickup-reservation/spec.md "Reservation Holds Stock as
  // Reserved-Unpaid" and "Bounded Hold Window", and design.md's "RESERVED
  // ... → closing time of the next open business day" rule. Relies on
  // prisma/seed.ts's StoreHours default (Mon-Fri open, Sat/Sun closed, no
  // Holiday rows) already being seeded in the local DB.
  describe("createPendingOrder — PICKUP_CASH creates a RESERVED reservation (tasks 6.2/6.3)", () => {
    it("creates Order(RESERVED) and holds stock as reserved-unpaid — onHand untouched, not sold-paid", async () => {
      const { variant } = await makeProductWithVariant(4, 12000);

      const order = await createPendingOrder(prisma, {
        ...guestContact(),
        method: "PICKUP_CASH",
        items: [{ variantId: variant.id, qty: 1 }],
      });
      createdOrderIds.push(order.id);

      expect(order.status).toBe("RESERVED");
      expect(order.expiresAt).not.toBeNull();

      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.held).toBe(1);
      expect(updatedVariant.onHand).toBe(4);
      expect(updatedVariant.onHand - updatedVariant.held).toBe(3);
    });

    it("RESERVED expiresAt matches the next-open-business-day closing time computed from live StoreHours+Holiday", async () => {
      const { variant } = await makeProductWithVariant(3, 9000);
      const now = new Date();

      const order = await createPendingOrder(prisma, {
        ...guestContact(),
        method: "PICKUP_CASH",
        items: [{ variantId: variant.id, qty: 1 }],
      });
      createdOrderIds.push(order.id);

      const [storeHours, holidays] = await Promise.all([
        prisma.storeHours.findMany(),
        prisma.holiday.findMany(),
      ]);
      const expected = nextOpenBusinessDayClose({
        now,
        storeHours,
        holidays: holidays.map((h) => h.date),
      });

      expect(order.expiresAt!.getTime()).toBe(expected.getTime());
    });

    it("triangulation: MP checkout still gets the +30min PENDING_PAYMENT expiry, unaffected by the RESERVED branch", async () => {
      const { variant } = await makeProductWithVariant(2, 10000);
      const before = Date.now();

      const order = await createPendingOrder(prisma, {
        ...guestContact(),
        method: "MP",
        items: [{ variantId: variant.id, qty: 1 }],
      });
      createdOrderIds.push(order.id);

      expect(order.status).toBe("PENDING_PAYMENT");
      const expiresInMinutes = (order.expiresAt!.getTime() - before) / 60_000;
      expect(expiresInMinutes).toBeGreaterThan(29);
      expect(expiresInMinutes).toBeLessThan(31);
    });
  });

  // tasks.md 6.7 — staff marks an order picked up. Backs
  // specs/order-lifecycle/spec.md "Staff marks order picked up" (PAID path:
  // stock already committed, pure status transition) and
  // specs/pickup-reservation/spec.md "Reservation fulfilled within window"
  // (RESERVED path: cash is paid in person at pickup, so THIS transition is
  // where reserved-unpaid stock commits to sold-paid — see
  // schema.prisma's Order.status doc: "RESERVED -> PAID/PICKED_UP").
  describe("markPickedUp — terminal state transition (task 6.7)", () => {
    async function makePendingOrder(onHand: number, qty = 1) {
      const { variant } = await makeProductWithVariant(onHand, 20000);
      const order = await createPendingOrder(prisma, {
        ...guestContact(),
        method: "MP",
        items: [{ variantId: variant.id, qty }],
      });
      createdOrderIds.push(order.id);
      return { variant, order };
    }

    it("PAID -> PICKED_UP: pure status transition, stock is NOT touched again (already decremented at PAID)", async () => {
      const { variant, order } = await makePendingOrder(5, 2);
      await confirmPaymentApproved(prisma, {
        orderId: order.id,
        mpPaymentId: `mp-pickedup-${randomUUID()}`,
        amount: 40000,
        rawPayload: { status: "approved" },
      });

      const result = await markPickedUp(prisma, order.id);

      expect(result.status).toBe("PICKED_UP");
      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.onHand).toBe(3);
      expect(updatedVariant.held).toBe(0);
    });

    it("RESERVED -> PICKED_UP: cash paid at pickup — reserved-unpaid stock commits to sold-paid in this same transition", async () => {
      const { variant } = await makeProductWithVariant(4, 15000);
      const order = await createPendingOrder(prisma, {
        ...guestContact(),
        method: "PICKUP_CASH",
        items: [{ variantId: variant.id, qty: 2 }],
      });
      createdOrderIds.push(order.id);

      const result = await markPickedUp(prisma, order.id);

      expect(result.status).toBe("PICKED_UP");
      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.onHand).toBe(2);
      expect(updatedVariant.held).toBe(0);
    });

    it("rejects marking an already-PICKED_UP order picked up again, and does not touch stock a second time", async () => {
      const { variant, order } = await makePendingOrder(3, 1);
      await confirmPaymentApproved(prisma, {
        orderId: order.id,
        mpPaymentId: `mp-double-${randomUUID()}`,
        amount: 20000,
        rawPayload: { status: "approved" },
      });
      await markPickedUp(prisma, order.id);

      await expect(markPickedUp(prisma, order.id)).rejects.toThrow(
        InvalidOrderStatusTransitionError,
      );

      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.onHand).toBe(2);
    });

    it("rejects marking a still-PENDING_PAYMENT (unpaid MP) order as picked up", async () => {
      const { order } = await makePendingOrder(2, 1);

      await expect(markPickedUp(prisma, order.id)).rejects.toThrow(
        InvalidOrderStatusTransitionError,
      );
    });

    it("throws OrderNotFoundError for an unknown orderId", async () => {
      await expect(markPickedUp(prisma, `nope-${randomUUID()}`)).rejects.toThrow(
        OrderNotFoundError,
      );
    });
  });

  describe("cancelOrder — staff cancellation of PENDING_PAYMENT/RESERVED (proposal 2026-08-18-admin-cancelar-pedido)", () => {
    async function makePendingOrder(onHand: number, qty = 1) {
      const { variant } = await makeProductWithVariant(onHand, 20000);
      const order = await createPendingOrder(prisma, {
        ...guestContact(),
        method: "MP",
        items: [{ variantId: variant.id, qty }],
      });
      createdOrderIds.push(order.id);
      return { variant, order };
    }

    async function makeTwoLineOrder(method: "MP" | "PICKUP_CASH") {
      const { variant: variantA } = await makeProductWithVariant(5, 20000);
      const { variant: variantB } = await makeProductWithVariant(3, 15000);
      const order = await createPendingOrder(prisma, {
        ...guestContact(),
        method,
        items: [
          { variantId: variantA.id, qty: 2 },
          { variantId: variantB.id, qty: 1 },
        ],
      });
      createdOrderIds.push(order.id);
      return { variantA, variantB, order };
    }

    it("PENDING_PAYMENT -> CANCELLED: releases held stock, clears expiresAt, and writes a StockMovement(RELEASE) row", async () => {
      const { variant, order } = await makePendingOrder(4, 2);

      const result = await cancelOrder(prisma, order.id);

      expect(result.status).toBe("CANCELLED");
      expect(result.expiresAt).toBeNull();
      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.onHand).toBe(4);
      expect(updatedVariant.held).toBe(0);
      const movements = await prisma.stockMovement.findMany({
        where: { orderId: order.id, variantId: variant.id, reason: "RELEASE" },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0]?.delta).toBe(-2);
    });

    it("RESERVED -> CANCELLED: releases every line's held stock and writes one StockMovement(RELEASE) row per item (multi-line order)", async () => {
      const { variantA, variantB, order } = await makeTwoLineOrder("PICKUP_CASH");

      const result = await cancelOrder(prisma, order.id);

      expect(result.status).toBe("CANCELLED");
      expect(result.expiresAt).toBeNull();
      const updatedA = await prisma.variant.findUniqueOrThrow({ where: { id: variantA.id } });
      const updatedB = await prisma.variant.findUniqueOrThrow({ where: { id: variantB.id } });
      expect(updatedA.onHand).toBe(5);
      expect(updatedA.held).toBe(0);
      expect(updatedB.onHand).toBe(3);
      expect(updatedB.held).toBe(0);
      const movementsA = await prisma.stockMovement.findMany({
        where: { orderId: order.id, variantId: variantA.id, reason: "RELEASE" },
      });
      const movementsB = await prisma.stockMovement.findMany({
        where: { orderId: order.id, variantId: variantB.id, reason: "RELEASE" },
      });
      expect(movementsA).toHaveLength(1);
      expect(movementsB).toHaveLength(1);
    });

    it.each([
      ["PAID" as const],
      ["PICKED_UP" as const],
      ["EXPIRED" as const],
      ["CANCELLED" as const],
    ])("rejects cancelling an order already in %s status, and mutates nothing", async (status) => {
      const { variant, order } = await makePendingOrder(3, 1);
      await prisma.order.update({ where: { id: order.id }, data: { status } });

      await expect(cancelOrder(prisma, order.id)).rejects.toThrow(
        InvalidOrderStatusTransitionError,
      );

      const unchangedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(unchangedOrder.status).toBe(status);
      const unchangedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(unchangedVariant.onHand).toBe(3);
      expect(unchangedVariant.held).toBe(1);
    });

    it("throws OrderNotFoundError for an unknown orderId", async () => {
      await expect(cancelOrder(prisma, `nope-${randomUUID()}`)).rejects.toThrow(
        OrderNotFoundError,
      );
    });
  });
});
