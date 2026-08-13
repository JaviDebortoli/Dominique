import { createHmac, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import { createPendingOrder } from "@/modules/orders/order.service";
import type { MercadoPagoClient, MpPayment } from "./mercadopago";
import { processMercadoPagoWebhook } from "./webhook.service";

// Integration tests against the real local Postgres, with a fake
// MercadoPagoClient test double injected — no network access or live MP
// credentials needed (per the explicit task instruction: "inject/mock the
// MP SDK boundary ... so webhook signature validation, idempotency, and
// state-transition logic are fully unit/integration-testable ... WITHOUT
// needing live MP credentials or network access").
//
// Backs specs/payment-mercadopago/spec.md and design.md's Threat Matrix row
// "Untrusted webhook intake":
//   - tasks.md 5.2 (RED, written first): forged/replayed webhook + tampered
//     body ⇒ rejected, no state change
//   - tasks.md 5.3 (GREEN): valid x-signature, body is NEVER read for
//     business logic (this function's input has no room for a body at all
//     — see webhook.service.ts's module doc)
//   - tasks.md 5.4-5.7: end-to-end wiring for approved/rejected/pending/
//     duplicate, proving processMercadoPagoWebhook correctly dispatches to
//     order.service's already-exhaustively-tested transitions
//     (order.service.test.ts covers the deep state-machine triangulation;
//     this file proves the webhook entry point wires it correctly).
const WEBHOOK_SECRET = "test-webhook-secret";

function validSignatureHeader(dataId: string, requestId: string, ts = String(Math.floor(Date.now() / 1000))) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", WEBHOOK_SECRET).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

class FakeMercadoPagoClient implements MercadoPagoClient {
  public getPaymentCalls: string[] = [];
  private payments = new Map<string, MpPayment>();

  registerPayment(payment: MpPayment) {
    this.payments.set(payment.id, payment);
  }

  async createPreference(): Promise<never> {
    throw new Error("not used in webhook tests");
  }

  async getPayment(paymentId: string): Promise<MpPayment> {
    this.getPaymentCalls.push(paymentId);
    const payment = this.payments.get(paymentId);
    if (!payment) {
      throw new Error(`FakeMercadoPagoClient: no payment registered for id ${paymentId}`);
    }
    return payment;
  }
}

describe("webhook.service — processMercadoPagoWebhook (integration, real Postgres, fake MP client)", () => {
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

  async function makePendingOrder(onHand: number, qty = 1) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Webhook Test ${suffix}`, slug: `webhook-test-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Producto Webhook ${suffix}`,
      slug: `producto-webhook-${suffix}`,
      price: 15000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `WH-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);
    const variant = product.variants[0];

    const order = await createPendingOrder(prisma, {
      buyerName: "Cliente Webhook",
      phone: "3815550099",
      email: "webhook@example.com",
      method: "MP",
      items: [{ variantId: variant.id, qty }],
    });
    createdOrderIds.push(order.id);

    return { variant, order };
  }

  describe("Threat matrix (task 5.2, written before signature validation existed — the RED for task 5.3)", () => {
    it("rejects a forged signature (wrong secret) and never calls the MP API or changes order state", async () => {
      const { order } = await makePendingOrder(3, 1);
      const dataId = `pay-forged-${randomUUID()}`;
      const requestId = `req-${randomUUID()}`;
      const forgedHeader = (() => {
        const ts = String(Math.floor(Date.now() / 1000));
        const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
        const v1 = createHmac("sha256", "attacker-does-not-know-the-real-secret").update(manifest).digest("hex");
        return `ts=${ts},v1=${v1}`;
      })();

      const mpClient = new FakeMercadoPagoClient();
      mpClient.registerPayment({
        id: dataId,
        status: "approved",
        externalReference: order.id,
        transactionAmount: 15000,
      });

      const outcome = await processMercadoPagoWebhook({
        prisma,
        getMpClient: () => mpClient,
        webhookSecret: WEBHOOK_SECRET,
        signatureHeader: forgedHeader,
        requestId,
        dataId,
      });

      expect(outcome.kind).toBe("invalid_signature");
      expect(mpClient.getPaymentCalls).toHaveLength(0);

      const unchangedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(unchangedOrder.status).toBe("PENDING_PAYMENT");
    });

    it("rejects a replayed signature (real signature for a different dataId reused here)", async () => {
      const { order } = await makePendingOrder(2, 1);
      const realDataId = `pay-real-${randomUUID()}`;
      const requestId = `req-${randomUUID()}`;
      // A signature that WAS validly computed — but for a different
      // payment id than the one this request claims (replay/substitution).
      const replayedHeader = validSignatureHeader(realDataId, requestId);
      const claimedDataId = `pay-claimed-${randomUUID()}`;

      const mpClient = new FakeMercadoPagoClient();
      mpClient.registerPayment({
        id: claimedDataId,
        status: "approved",
        externalReference: order.id,
        transactionAmount: 15000,
      });

      const outcome = await processMercadoPagoWebhook({
        prisma,
        getMpClient: () => mpClient,
        webhookSecret: WEBHOOK_SECRET,
        signatureHeader: replayedHeader,
        requestId,
        dataId: claimedDataId,
      });

      expect(outcome.kind).toBe("invalid_signature");
      expect(mpClient.getPaymentCalls).toHaveLength(0);

      const unchangedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(unchangedOrder.status).toBe("PENDING_PAYMENT");
    });

    it("tampered body amount has zero effect — this function has no body parameter at all; only the server-verified getPayment() response drives state", async () => {
      const { order, variant } = await makePendingOrder(4, 1);
      const dataId = `pay-tamper-${randomUUID()}`;
      const requestId = `req-${randomUUID()}`;
      const header = validSignatureHeader(dataId, requestId);

      const mpClient = new FakeMercadoPagoClient();
      // The REAL server-verified amount is 15000 — an attacker claiming a
      // different amount in a POST body (which this function structurally
      // never reads) cannot influence anything: Payment.amount below can
      // only ever reflect what getPayment() (the fake, standing in for the
      // real signed server call) returned.
      mpClient.registerPayment({
        id: dataId,
        status: "approved",
        externalReference: order.id,
        transactionAmount: 15000,
      });

      const outcome = await processMercadoPagoWebhook({
        prisma,
        getMpClient: () => mpClient,
        webhookSecret: WEBHOOK_SECRET,
        signatureHeader: header,
        requestId,
        dataId,
      });

      expect(outcome.kind).toBe("approved");
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(Number(payment.amount)).toBe(15000);

      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.onHand).toBe(3);
    });
  });

  describe("GREEN — full wiring for approved/rejected/pending/duplicate (tasks 5.3-5.7)", () => {
    it("approved: commits the order to PAID and decrements stock (5.3/5.4)", async () => {
      const { order, variant } = await makePendingOrder(5, 2);
      const dataId = `pay-approved-${randomUUID()}`;
      const requestId = `req-${randomUUID()}`;
      const header = validSignatureHeader(dataId, requestId);

      const mpClient = new FakeMercadoPagoClient();
      mpClient.registerPayment({
        id: dataId,
        status: "approved",
        externalReference: order.id,
        transactionAmount: 30000,
      });

      const outcome = await processMercadoPagoWebhook({
        prisma,
        getMpClient: () => mpClient,
        webhookSecret: WEBHOOK_SECRET,
        signatureHeader: header,
        requestId,
        dataId,
      });

      expect(outcome).toEqual({ kind: "approved", orderId: order.id, duplicate: false });
      expect(mpClient.getPaymentCalls).toEqual([dataId]);

      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe("PAID");
      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.onHand).toBe(3);
      expect(updatedVariant.held).toBe(0);
    });

    it("rejected: releases held stock and cancels the order, onHand untouched (5.5)", async () => {
      const { order, variant } = await makePendingOrder(4, 1);
      const dataId = `pay-rejected-${randomUUID()}`;
      const requestId = `req-${randomUUID()}`;
      const header = validSignatureHeader(dataId, requestId);

      const mpClient = new FakeMercadoPagoClient();
      mpClient.registerPayment({
        id: dataId,
        status: "rejected",
        externalReference: order.id,
        transactionAmount: 15000,
      });

      const outcome = await processMercadoPagoWebhook({
        prisma,
        getMpClient: () => mpClient,
        webhookSecret: WEBHOOK_SECRET,
        signatureHeader: header,
        requestId,
        dataId,
      });

      expect(outcome).toEqual({ kind: "rejected", orderId: order.id });
      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe("CANCELLED");
      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.onHand).toBe(4);
      expect(updatedVariant.held).toBe(0);
    });

    it("pending: stays PENDING_PAYMENT, extends expiresAt ~3 days, no decrement (5.6)", async () => {
      const { order, variant } = await makePendingOrder(4, 1);
      const dataId = `pay-pending-${randomUUID()}`;
      const requestId = `req-${randomUUID()}`;
      const header = validSignatureHeader(dataId, requestId);
      const before = Date.now();

      const mpClient = new FakeMercadoPagoClient();
      mpClient.registerPayment({
        id: dataId,
        status: "pending",
        externalReference: order.id,
        transactionAmount: 15000,
      });

      const outcome = await processMercadoPagoWebhook({
        prisma,
        getMpClient: () => mpClient,
        webhookSecret: WEBHOOK_SECRET,
        signatureHeader: header,
        requestId,
        dataId,
      });

      expect(outcome).toEqual({ kind: "pending", orderId: order.id });
      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe("PENDING_PAYMENT");
      const expiresInDays = (updatedOrder.expiresAt!.getTime() - before) / (24 * 60 * 60 * 1000);
      expect(expiresInDays).toBeGreaterThan(2.9);

      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.held).toBe(1);
    });

    it("duplicate: the same dataId delivered twice (sequential) does not double-decrement (5.7)", async () => {
      const { order, variant } = await makePendingOrder(3, 1);
      const dataId = `pay-dup-${randomUUID()}`;
      const requestId = `req-${randomUUID()}`;
      const header = validSignatureHeader(dataId, requestId);

      const mpClient = new FakeMercadoPagoClient();
      mpClient.registerPayment({
        id: dataId,
        status: "approved",
        externalReference: order.id,
        transactionAmount: 15000,
      });

      const webhookRequest = () =>
        processMercadoPagoWebhook({
          prisma,
          getMpClient: () => mpClient,
          webhookSecret: WEBHOOK_SECRET,
          signatureHeader: header,
          requestId,
          dataId,
        });

      const first = await webhookRequest();
      const second = await webhookRequest();

      expect(first).toEqual({ kind: "approved", orderId: order.id, duplicate: false });
      expect(second).toEqual({ kind: "approved", orderId: order.id, duplicate: true });

      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.onHand).toBe(2);
      expect(updatedVariant.held).toBe(0);

      const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
      expect(payments).toHaveLength(1);
    });

    it("missing data.id: rejected before any signature check or MP API call", async () => {
      const mpClient = new FakeMercadoPagoClient();
      const getPaymentSpy = vi.spyOn(mpClient, "getPayment");

      const outcome = await processMercadoPagoWebhook({
        prisma,
        getMpClient: () => mpClient,
        webhookSecret: WEBHOOK_SECRET,
        signatureHeader: validSignatureHeader("whatever", "req-1"),
        requestId: "req-1",
        dataId: null,
      });

      expect(outcome).toEqual({ kind: "missing_data_id" });
      expect(getPaymentSpy).not.toHaveBeenCalled();
    });

    it("unknown order (external_reference does not match any Order) resolves to order_not_found without throwing", async () => {
      const dataId = `pay-unknown-order-${randomUUID()}`;
      const requestId = `req-${randomUUID()}`;
      const header = validSignatureHeader(dataId, requestId);

      const mpClient = new FakeMercadoPagoClient();
      mpClient.registerPayment({
        id: dataId,
        status: "approved",
        externalReference: `no-such-order-${randomUUID()}`,
        transactionAmount: 15000,
      });

      const outcome = await processMercadoPagoWebhook({
        prisma,
        getMpClient: () => mpClient,
        webhookSecret: WEBHOOK_SECRET,
        signatureHeader: header,
        requestId,
        dataId,
      });

      expect(outcome.kind).toBe("order_not_found");
    });
  });
});
