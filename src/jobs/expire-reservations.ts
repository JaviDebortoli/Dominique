// Expiry sweep — tasks.md 6.4/6.5, design.md D6.
//
// Backs specs/pickup-reservation/spec.md "Auto-Release on Expiry" and
// "Reservation Never Confused With Confirmed Payment", and the "Sequence —
// Stock & Reservation" diagram in design.md:
//
//   sweep every 15m → held-=q → EXPIRED
//                     WHERE status IN ('RESERVED','PENDING_PAYMENT')
//                     AND expiresAt<now()
//                     (PAID/PICKED_UP are unreachable: no hold left
//                      and status excluded ⇒ rule 4 holds)
//
// D6: run as node-cron inside the single PM2 process (no cluster mode —
// deploy/ecosystem.config.js, Phase 8), so there is never more than one
// sweep running concurrently and no leader-election mechanism is needed.
// scheduleExpireReservationsSweep() is wired once at server startup via
// src/instrumentation.ts's register() hook.

import cron, { type ScheduledTask } from "node-cron";
import { StockMovementReason, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { release } from "@/modules/inventory/stock.service";

const SWEEPABLE_STATUSES = ["RESERVED", "PENDING_PAYMENT"] as const;

export interface SweepResult {
  /** Order ids actually transitioned to EXPIRED by this sweep call. */
  expiredOrderIds: string[];
}

/**
 * Scans for RESERVED/PENDING_PAYMENT orders whose `expiresAt` has elapsed,
 * releases every line's `held` stock back to availability (never touching
 * `onHand` — an expired hold was never sold), and marks the order EXPIRED.
 *
 * Each candidate is processed in its own transaction that RE-CHECKS the
 * order's current status before mutating anything: between the initial
 * SELECT and this sweep actually running, a concurrent webhook
 * (confirmPaymentApproved/RejectedOrCancelled) or staff pickup
 * (markPickedUp) may have already moved the order out of
 * RESERVED/PENDING_PAYMENT — the same out-of-order-delivery caution D4
 * documents for the webhook path applies here (an expired-looking order
 * that just got paid must not have its stock yanked back).
 */
export async function sweepExpiredReservations(
  client: PrismaClient,
  now: Date = new Date(),
): Promise<SweepResult> {
  const candidates = await client.order.findMany({
    where: {
      status: { in: [...SWEEPABLE_STATUSES] },
      expiresAt: { lt: now },
    },
    include: { items: true },
  });

  const expiredOrderIds: string[] = [];

  for (const order of candidates) {
    const expired = await client.$transaction(
      async (tx) => {
        const current = await tx.order.findUnique({ where: { id: order.id } });
        const stillSweepable =
          current !== null &&
          (SWEEPABLE_STATUSES as readonly string[]).includes(current.status) &&
          current.expiresAt !== null &&
          current.expiresAt.getTime() < now.getTime();

        if (!stillSweepable) {
          return false;
        }

        for (const item of order.items) {
          await release(tx, {
            variantId: item.variantId,
            qty: item.qty,
            orderId: order.id,
            reason: StockMovementReason.EXPIRE,
          });
        }

        await tx.order.update({
          where: { id: order.id },
          data: { status: "EXPIRED", expiresAt: null },
        });

        return true;
      },
      { maxWait: 10_000, timeout: 10_000 },
    );

    if (expired) {
      expiredOrderIds.push(order.id);
    }
  }

  return { expiredOrderIds };
}

/**
 * tasks.md 6.5 — registers the sweep as an in-process node-cron job, every
 * 15 minutes (`*​/15 * * * *`). A failed sweep run is logged, not thrown —
 * node-cron has no built-in caller to propagate a rejection to, and one
 * missed/failed sweep must not crash the whole Next.js server process; the
 * next scheduled run 15 minutes later will pick up whatever is still
 * expired.
 */
export function scheduleExpireReservationsSweep(): ScheduledTask {
  return cron.schedule("*/15 * * * *", () => {
    sweepExpiredReservations(prisma).catch((error: unknown) => {
      console.error("expire-reservations sweep failed", error);
    });
  });
}
