// MercadoPago webhook orchestration — the untrusted-entry-point business
// logic behind app/api/webhooks/mercadopago/route.ts (design.md D1: logic
// lives in src/modules/*, the route stays a thin adapter).
//
// Backs specs/payment-mercadopago/spec.md and design.md's Threat Matrix row
// "Untrusted webhook intake": validate `x-signature`, ignore body
// amounts/status, re-fetch via the Get Payment API, always answer 200 after
// persisting (the route.ts maps the returned outcome to the actual HTTP
// status — this function itself has no knowledge of HTTP).
//
// DELIBERATE DESIGN CHOICE: HandleWebhookInput has NO body/payload field at
// all. MercadoPago's webhook POST body is never parsed here — every value
// this function trusts (payment status, amount, external_reference) comes
// exclusively from mpClient.getPayment(dataId), the server-side,
// access-token-authenticated Get Payment API call. `dataId` itself comes
// from the URL query string (`?data.id=...`), which is exactly what
// MercadoPago's own x-signature manifest covers
// (`id:{data.id};request-id:{x-request-id};ts:{ts};`). A forged or
// tampered request body therefore has structurally zero influence on the
// outcome — see webhook.service.test.ts's "tampered body amount" test.
//
// tasks.md 5.2 (RED: forged/replayed webhook + tampered body ⇒ rejected, no
// state change), 5.3 (GREEN: signature check via mercadopago.ts), and the
// dispatch to order.service.ts's already-tested state transitions (5.4-5.7).

import type { PrismaClient } from "@/generated/prisma/client";
import {
  confirmPaymentApproved,
  confirmPaymentPending,
  confirmPaymentRejectedOrCancelled,
  OrderNotFoundError,
} from "@/modules/orders/order.service";
import { verifyWebhookSignature, type MercadoPagoClient } from "./mercadopago";

export interface HandleWebhookInput {
  prisma: PrismaClient;
  /** Lazy accessor — only invoked AFTER the signature check passes, so a
   * forged/replayed request never requires a real MercadoPago client (and
   * therefore never requires MP_ACCESS_TOKEN) to be constructible at all.
   * This matters concretely today: no live MP credentials exist in this
   * repo yet, and rejecting a bad signature must still work regardless. */
  getMpClient: () => MercadoPagoClient;
  webhookSecret: string;
  signatureHeader: string | null;
  requestId: string | null;
  /** The `data.id` query-string parameter — the payment id MercadoPago
   * signs and the value passed to Get Payment. NEVER the body's `data.id`
   * (see module doc above). */
  dataId: string | null;
}

export type WebhookOutcome =
  | { kind: "missing_data_id" }
  | { kind: "invalid_signature" }
  | { kind: "order_not_found"; orderId: string }
  | { kind: "approved"; orderId: string; duplicate: boolean }
  | { kind: "rejected"; orderId: string }
  | { kind: "pending"; orderId: string }
  | { kind: "ignored_status"; orderId: string; status: string };

export async function processMercadoPagoWebhook(input: HandleWebhookInput): Promise<WebhookOutcome> {
  if (!input.dataId) {
    return { kind: "missing_data_id" };
  }

  // Signature check FIRST, before any MercadoPago API call or DB write —
  // threat matrix "Untrusted webhook intake": forged/replayed requests are
  // rejected without ever touching mpClient or Postgres.
  const validSignature = verifyWebhookSignature({
    signatureHeader: input.signatureHeader,
    requestId: input.requestId,
    dataId: input.dataId,
    secret: input.webhookSecret,
  });
  if (!validSignature) {
    return { kind: "invalid_signature" };
  }

  // Server-side re-fetch (specs/payment-mercadopago "Server-Side Payment
  // Verification") — the only source of truth for status/amount. The
  // client is constructed here, lazily, only now that the signature is
  // proven valid.
  const mpClient = input.getMpClient();
  const payment = await mpClient.getPayment(input.dataId);

  if (!payment.externalReference) {
    return { kind: "order_not_found", orderId: "" };
  }

  const confirmInput = {
    orderId: payment.externalReference,
    mpPaymentId: payment.id,
    amount: payment.transactionAmount,
    rawPayload: payment,
  };

  try {
    switch (payment.status) {
      case "approved": {
        const result = await confirmPaymentApproved(input.prisma, confirmInput);
        return { kind: "approved", orderId: payment.externalReference, duplicate: result.duplicate };
      }
      case "rejected":
      case "cancelled": {
        await confirmPaymentRejectedOrCancelled(input.prisma, {
          ...confirmInput,
          status: payment.status as "rejected" | "cancelled",
        });
        return { kind: "rejected", orderId: payment.externalReference };
      }
      case "pending":
      case "in_process": {
        await confirmPaymentPending(input.prisma, confirmInput);
        return { kind: "pending", orderId: payment.externalReference };
      }
      default:
        return { kind: "ignored_status", orderId: payment.externalReference, status: payment.status };
    }
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      return { kind: "order_not_found", orderId: payment.externalReference };
    }
    throw error;
  }
}
