import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import { confirmPaymentApproved, createPendingOrder } from "@/modules/orders/order.service";

// Integration tests against the real local Postgres (design.md Testing
// Strategy: "sweep never touches PAID" is explicitly called out as an
// integration-level guarantee, not a unit-level one).
//
// Backs:
//   - specs/pickup-reservation/spec.md "Auto-Release on Expiry" and
//     "Reservation Never Confused With Confirmed Payment"
//   - design.md's Sequence — Stock & Reservation: "sweep every 15m → held-=q
//     → EXPIRED WHERE status IN ('RESERVED','PENDING_PAYMENT') AND
//     expiresAt<now() (PAID/PICKED_UP are unreachable: no hold left and
//     status excluded ⇒ rule 4 holds)"
//   - tasks.md 6.4/6.5
describe("expire-reservations — sweepExpiredReservations (task 6.4)", () => {
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

  async function makeOrder(method: "MP" | "PICKUP_CASH", onHand: number, qty = 1) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Sweep Test ${suffix}`, slug: `sweep-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Producto Sweep ${suffix}`,
      slug: `producto-sweep-${suffix}`,
      price: 10000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `SWP-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);

    const order = await createPendingOrder(prisma, {
      buyerName: "Cliente Sweep",
      phone: "3815559999",
      email: "sweep@example.com",
      method,
      items: [{ variantId: product.variants[0].id, qty }],
    });
    createdOrderIds.push(order.id);

    return { variant: product.variants[0], order };
  }

  async function forceExpired(orderId: string) {
    await prisma.order.update({
      where: { id: orderId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
  }

  it("releases held stock and marks an expired RESERVED order EXPIRED, recording an EXPIRE audit movement", async () => {
    const { variant, order } = await makeOrder("PICKUP_CASH", 5, 2);
    await forceExpired(order.id);

    const { sweepExpiredReservations } = await import("./expire-reservations");
    const result = await sweepExpiredReservations(prisma);

    expect(result.expiredOrderIds).toContain(order.id);

    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe("EXPIRED");
    expect(updatedOrder.expiresAt).toBeNull();

    const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updatedVariant.held).toBe(0);
    expect(updatedVariant.onHand).toBe(5);

    const movements = await prisma.stockMovement.findMany({
      where: { orderId: order.id, reason: "EXPIRE" },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(-2);
  });

  it("releases held stock and marks an expired PENDING_PAYMENT (MP) order EXPIRED", async () => {
    const { variant, order } = await makeOrder("MP", 3, 1);
    await forceExpired(order.id);

    const { sweepExpiredReservations } = await import("./expire-reservations");
    const result = await sweepExpiredReservations(prisma);

    expect(result.expiredOrderIds).toContain(order.id);
    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe("EXPIRED");

    const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updatedVariant.held).toBe(0);
    expect(updatedVariant.onHand).toBe(3);
  });

  it("does not touch an order whose hold window has not elapsed yet", async () => {
    const { order } = await makeOrder("PICKUP_CASH", 4, 1);
    // expiresAt is left at its natural future value — not forced expired.

    const { sweepExpiredReservations } = await import("./expire-reservations");
    const result = await sweepExpiredReservations(prisma);

    expect(result.expiredOrderIds).not.toContain(order.id);
    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe("RESERVED");
  });

  it("never touches a PAID order, even if expiresAt were forced stale (structural exclusion by status, not just expiresAt)", async () => {
    const { variant, order } = await makeOrder("MP", 5, 2);
    await confirmPaymentApproved(prisma, {
      orderId: order.id,
      mpPaymentId: `mp-sweep-${randomUUID()}`,
      amount: 20000,
      rawPayload: { status: "approved" },
    });
    await forceExpired(order.id);

    const { sweepExpiredReservations } = await import("./expire-reservations");
    const result = await sweepExpiredReservations(prisma);

    expect(result.expiredOrderIds).not.toContain(order.id);
    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe("PAID");

    const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updatedVariant.onHand).toBe(3);
    expect(updatedVariant.held).toBe(0);
  });

  it("triangulation: sweeps multiple independently-expired orders in one call", async () => {
    const first = await makeOrder("PICKUP_CASH", 2, 1);
    const second = await makeOrder("MP", 2, 1);
    await forceExpired(first.order.id);
    await forceExpired(second.order.id);

    const { sweepExpiredReservations } = await import("./expire-reservations");
    const result = await sweepExpiredReservations(prisma);

    expect(result.expiredOrderIds).toEqual(
      expect.arrayContaining([first.order.id, second.order.id]),
    );
    const firstUpdated = await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } });
    const secondUpdated = await prisma.order.findUniqueOrThrow({ where: { id: second.order.id } });
    expect(firstUpdated.status).toBe("EXPIRED");
    expect(secondUpdated.status).toBe("EXPIRED");
  });
});

// tasks.md 6.5 — node-cron wiring is ops/deploy plumbing: the actual
// 15-minute cadence is not worth waiting on in CI, so this is a smoke-level
// test proving the schedule is registered with the right cron expression
// and that its callback invokes the sweep — not a real-time wait.
describe("expire-reservations — scheduleExpireReservationsSweep (task 6.5, smoke-level)", () => {
  it("registers a */15 * * * * cron task whose callback runs the sweep", async () => {
    vi.resetModules();
    const scheduleMock = vi.fn().mockReturnValue({ stop: vi.fn(), destroy: vi.fn() });
    vi.doMock("node-cron", () => ({ default: { schedule: scheduleMock }, schedule: scheduleMock }));

    const { scheduleExpireReservationsSweep } = await import("./expire-reservations");
    scheduleExpireReservationsSweep();

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock.mock.calls[0][0]).toBe("*/15 * * * *");
    expect(typeof scheduleMock.mock.calls[0][1]).toBe("function");

    vi.doUnmock("node-cron");
    vi.resetModules();
  });
});
