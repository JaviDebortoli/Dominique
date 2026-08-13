import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPreferenceRequest, verifyWebhookSignature } from "./mercadopago";

// Unit tests only — no DB, no network, no live MercadoPago credentials
// needed (see task instructions: "the actual MP SDK call is a thin,
// mockable boundary" — this file proves the boundary's pure logic).
//
// Backs specs/payment-mercadopago/spec.md "Server-Side Payment Verification"
// and design.md's Threat Matrix row "Untrusted webhook intake": the
// `x-signature` HMAC scheme is MercadoPago's documented manifest format
// (`id:{data.id};request-id:{x-request-id};ts:{ts};`, HMAC-SHA256 hex,
// compared via the official SDK's WebhookSignatureValidator).
//
// tasks.md 5.1 (createPreference request shape) and 5.3 (signature
// validation, ignoring body content entirely — see webhook.service.ts,
// which never parses the request body for business logic).
describe("mercadopago — verifyWebhookSignature (tasks 5.2/5.3, pure HMAC check)", () => {
  const SECRET = "test-webhook-secret";
  const DATA_ID = "123456789";
  const REQUEST_ID = "req-abc-123";
  const TS = "1704908010";

  function realSignatureHeader(overrides?: { dataId?: string; requestId?: string; ts?: string; secret?: string }) {
    const dataId = overrides?.dataId ?? DATA_ID;
    const requestId = overrides?.requestId ?? REQUEST_ID;
    const ts = overrides?.ts ?? TS;
    const secret = overrides?.secret ?? SECRET;
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
    return `ts=${ts},v1=${v1}`;
  }

  it("accepts a correctly computed signature for the given dataId/requestId/secret", () => {
    const signatureHeader = realSignatureHeader();

    const result = verifyWebhookSignature({
      signatureHeader,
      requestId: REQUEST_ID,
      dataId: DATA_ID,
      secret: SECRET,
    });

    expect(result).toBe(true);
  });

  it("rejects a forged signature (wrong secret) — threat matrix: forged webhook", () => {
    const signatureHeader = realSignatureHeader({ secret: "attacker-guessed-secret" });

    const result = verifyWebhookSignature({
      signatureHeader,
      requestId: REQUEST_ID,
      dataId: DATA_ID,
      secret: SECRET,
    });

    expect(result).toBe(false);
  });

  it("rejects a replayed signature reused for a different dataId — threat matrix: replayed webhook", () => {
    // Attacker captures a real signature for payment A and replays the same
    // header while claiming a different dataId (payment B) in the request.
    const signatureHeaderForPaymentA = realSignatureHeader({ dataId: "111111111" });

    const result = verifyWebhookSignature({
      signatureHeader: signatureHeaderForPaymentA,
      requestId: REQUEST_ID,
      dataId: "222222222",
      secret: SECRET,
    });

    expect(result).toBe(false);
  });

  it("rejects when x-signature header is missing entirely", () => {
    const result = verifyWebhookSignature({
      signatureHeader: null,
      requestId: REQUEST_ID,
      dataId: DATA_ID,
      secret: SECRET,
    });

    expect(result).toBe(false);
  });

  it("rejects a malformed x-signature header that cannot be parsed", () => {
    const result = verifyWebhookSignature({
      signatureHeader: "not-a-valid-signature-header",
      requestId: REQUEST_ID,
      dataId: DATA_ID,
      secret: SECRET,
    });

    expect(result).toBe(false);
  });
});

describe("mercadopago — buildPreferenceRequest (task 5.1, pure preference mapping)", () => {
  it("maps order + items into a MercadoPago preference request body", () => {
    const request = buildPreferenceRequest({
      orderId: "order-123",
      publicCode: "DOM-ABCD1234",
      items: [{ title: "Vestido Talle M", quantity: 2, unitPrice: 15000 }],
      payerEmail: "cliente@example.com",
      baseUrl: "https://dominique.example.com",
    });

    expect(request.external_reference).toBe("order-123");
    expect(request.items).toEqual([
      { id: "order-123", title: "Vestido Talle M", quantity: 2, unit_price: 15000, currency_id: "ARS" },
    ]);
    expect(request.payer?.email).toBe("cliente@example.com");
    expect(request.notification_url).toBe(
      "https://dominique.example.com/api/webhooks/mercadopago",
    );
    expect(request.back_urls?.success).toBe("https://dominique.example.com/pedido/DOM-ABCD1234");
    expect(request.back_urls?.pending).toBe("https://dominique.example.com/pedido/DOM-ABCD1234");
    expect(request.back_urls?.failure).toBe("https://dominique.example.com/pedido/DOM-ABCD1234");
    expect(request.auto_return).toBe("approved");
  });

  it("triangulation: a second order with different items/publicCode produces a distinct, correctly-scoped request", () => {
    const request = buildPreferenceRequest({
      orderId: "order-999",
      publicCode: "DOM-ZZZZ9999",
      items: [
        { title: "Pollera Talle S", quantity: 1, unitPrice: 8000 },
        { title: "Blusa Talle U", quantity: 3, unitPrice: 5000 },
      ],
      baseUrl: "https://dominique.example.com",
    });

    expect(request.external_reference).toBe("order-999");
    expect(request.items).toHaveLength(2);
    expect(request.items?.[1]).toEqual({
      id: "order-999",
      title: "Blusa Talle U",
      quantity: 3,
      unit_price: 5000,
      currency_id: "ARS",
    });
    expect(request.back_urls?.success).toBe("https://dominique.example.com/pedido/DOM-ZZZZ9999");
    expect(request.payer).toBeUndefined();
  });
});
