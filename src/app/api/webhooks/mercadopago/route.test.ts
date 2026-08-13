import { createHmac, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import { createPendingOrder } from "@/modules/orders/order.service";
import type { MercadoPagoClient, MpPayment } from "@/modules/payments/mercadopago";

// HTTP-level tests for the webhook route — thin wiring over
// webhook.service.ts (business logic already exhaustively covered in
// webhook.service.test.ts). Calls the exported POST handler directly with a
// real Request (same pattern as app/api/checkout/route.test.ts).
//
// Backs design.md's Threat Matrix row "Untrusted webhook intake" and
// tasks.md 5.2/5.3: this is the file task 5.2 names explicitly — "write
// this test FIRST and confirm it fails against a naive/no-op handler
// before implementing 5.3" (confirmed: RED before route.ts existed at all,
// see the RED evidence in the apply-progress report).
//
// The real MP SDK boundary (createMercadoPagoClient) is swapped for a fake
// via vi.mock — no live credentials or network access needed, per the
// explicit task instruction.
const WEBHOOK_SECRET = "route-test-webhook-secret";

class FakeMercadoPagoClient implements MercadoPagoClient {
  public getPaymentCalls: string[] = [];
  private payments = new Map<string, MpPayment>();

  registerPayment(payment: MpPayment) {
    this.payments.set(payment.id, payment);
  }

  async createPreference(): Promise<never> {
    throw new Error("not used in webhook route tests");
  }

  async getPayment(paymentId: string): Promise<MpPayment> {
    this.getPaymentCalls.push(paymentId);
    const payment = this.payments.get(paymentId);
    if (!payment) throw new Error(`no fake payment registered for ${paymentId}`);
    return payment;
  }
}

const fakeClient = new FakeMercadoPagoClient();

vi.mock("@/modules/payments/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/payments/mercadopago")>();
  return {
    ...actual,
    createMercadoPagoClient: () => fakeClient,
  };
});

// Imported AFTER the mock so route.ts picks up the mocked
// createMercadoPagoClient (vi.mock is hoisted, but importing post-mock-
// declaration keeps the intent obvious).
const { POST } = await import("./route");

function webhookRequest(params: { dataId: string | null; signatureHeader: string | null; requestId: string | null }) {
  const url = new URL("http://localhost/api/webhooks/mercadopago");
  if (params.dataId) url.searchParams.set("data.id", params.dataId);
  const headers = new Headers();
  if (params.signatureHeader) headers.set("x-signature", params.signatureHeader);
  if (params.requestId) headers.set("x-request-id", params.requestId);
  return new Request(url, { method: "POST", headers, body: JSON.stringify({ tampered: "body ignored" }) });
}

function realSignatureHeader(dataId: string, requestId: string, secret = WEBHOOK_SECRET) {
  const ts = String(Math.floor(Date.now() / 1000));
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

describe("POST /api/webhooks/mercadopago (integration, real Postgres, fake MP client via vi.mock)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdOrderIds: string[] = [];
  const originalWebhookSecret = process.env.MP_WEBHOOK_SECRET;

  process.env.MP_WEBHOOK_SECRET = WEBHOOK_SECRET;

  afterAll(async () => {
    process.env.MP_WEBHOOK_SECRET = originalWebhookSecret;
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
      data: { name: `Webhook Route ${suffix}`, slug: `webhook-route-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Producto Ruta Webhook ${suffix}`,
      slug: `producto-ruta-webhook-${suffix}`,
      price: 12000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `WHR-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);
    const variant = product.variants[0];

    const order = await createPendingOrder(prisma, {
      buyerName: "Cliente Ruta",
      phone: "3815550055",
      email: "ruta@example.com",
      method: "MP",
      items: [{ variantId: variant.id, qty }],
    });
    createdOrderIds.push(order.id);
    return { variant, order };
  }

  it("responds 401 for a forged x-signature and never reaches the MP client (threat matrix)", async () => {
    const { order } = await makePendingOrder(2, 1);
    const dataId = `route-forged-${randomUUID()}`;
    const requestId = `req-${randomUUID()}`;
    fakeClient.registerPayment({
      id: dataId,
      status: "approved",
      externalReference: order.id,
      transactionAmount: 12000,
    });
    const callsBefore = fakeClient.getPaymentCalls.length;

    const response = await POST(
      webhookRequest({
        dataId,
        requestId,
        signatureHeader: realSignatureHeader(dataId, requestId, "wrong-secret"),
      }),
    );

    expect(response.status).toBe(401);
    expect(fakeClient.getPaymentCalls.length).toBe(callsBefore);

    const unchangedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchangedOrder.status).toBe("PENDING_PAYMENT");
  });

  it("responds 400 when data.id is missing from the query string", async () => {
    const response = await POST(
      webhookRequest({ dataId: null, requestId: "req-1", signatureHeader: "ts=1,v1=deadbeef" }),
    );

    expect(response.status).toBe(400);
  });

  it("responds 200 and processes an approved payment end-to-end with a valid signature", async () => {
    const { order, variant } = await makePendingOrder(4, 1);
    const dataId = `route-approved-${randomUUID()}`;
    const requestId = `req-${randomUUID()}`;
    fakeClient.registerPayment({
      id: dataId,
      status: "approved",
      externalReference: order.id,
      transactionAmount: 12000,
    });

    const response = await POST(
      webhookRequest({
        dataId,
        requestId,
        signatureHeader: realSignatureHeader(dataId, requestId),
      }),
    );

    expect(response.status).toBe(200);
    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe("PAID");
    const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updatedVariant.onHand).toBe(3);
  });

  it("responds 200 (no-op) for a duplicate delivery of the same approved payment", async () => {
    const { order, variant } = await makePendingOrder(3, 1);
    const dataId = `route-dup-${randomUUID()}`;
    const requestId = `req-${randomUUID()}`;
    fakeClient.registerPayment({
      id: dataId,
      status: "approved",
      externalReference: order.id,
      transactionAmount: 12000,
    });
    const header = realSignatureHeader(dataId, requestId);

    const first = await POST(webhookRequest({ dataId, requestId, signatureHeader: header }));
    const second = await POST(webhookRequest({ dataId, requestId, signatureHeader: header }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updatedVariant.onHand).toBe(2);
  });
});
