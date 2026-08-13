// MercadoPago Checkout Pro integration — a thin, mockable wrapper around
// the official `mercadopago` Node SDK.
//
// Backs specs/payment-mercadopago/spec.md:
//   - "Server-Side Payment Verification" (never trust client-side redirect
//     params — GET /v1/payments/{id} is the only source of truth)
//   - "Idempotent Webhook Processing" (D4)
// and design.md's Threat Matrix row "Untrusted webhook intake": validate
// `x-signature` via HMAC before doing anything else, then re-fetch the
// payment server-side. The webhook route/service NEVER parses the request
// body for business logic (see webhook.service.ts) — the signature covers
// `data.id` from the URL query string, `x-request-id`, and `ts`, and every
// value that matters (status, amount, external_reference) is re-fetched
// from MercadoPago's Get Payment API, never trusted from the POST body.
//
// tasks.md 5.1 (createPreference + 303 to init_point) and 5.3 (signature
// validation via the SDK's own WebhookSignatureValidator — MercadoPago's
// documented manifest scheme, not a hand-rolled HMAC implementation).
//
// CREDENTIALS: MP_ACCESS_TOKEN / MP_WEBHOOK_SECRET are read from env (see
// .env.example for where to obtain them: developers.mercadopago.com.ar).
// No live sandbox credentials exist in this repo yet — createMercadoPagoClient()
// throws MissingMercadoPagoCredentialsError until the owner sets them up.
// Every test in this module and webhook.service.test.ts/order.service.test.ts
// injects a test-double MercadoPagoClient instead of calling the real SDK,
// so signature validation, idempotency, and state-transition logic are
// fully proven without network access.

import {
  InvalidWebhookSignatureError,
  MercadoPagoConfig,
  Payment as MpPaymentClient,
  Preference as MpPreferenceClient,
  WebhookSignatureValidator,
} from "mercadopago";
import type { PreferenceRequest } from "mercadopago/dist/clients/preference/commonTypes";

export class MissingMercadoPagoCredentialsError extends Error {
  constructor() {
    super(
      "MP_ACCESS_TOKEN is not set. Create a MercadoPago Developer account at " +
        "https://www.mercadopago.com.ar/developers and copy the access token " +
        "into .env (see .env.example) before accepting online payments.",
    );
    this.name = "MissingMercadoPagoCredentialsError";
  }
}

// ---------------------------------------------------------------------------
// Signature validation (task 5.3) — pure, no network, no SDK config needed.
// ---------------------------------------------------------------------------

export interface VerifyWebhookSignatureInput {
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string | null;
  secret: string;
}

/**
 * Validates the `x-signature` header using MercadoPago's own documented
 * manifest scheme (`id:{data.id};request-id:{x-request-id};ts:{ts};`,
 * HMAC-SHA256, constant-time compare) via the official SDK's
 * WebhookSignatureValidator. Returns a boolean instead of throwing so
 * call sites stay simple — the underlying SDK exception is caught here.
 */
export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
  try {
    WebhookSignatureValidator.validate({
      xSignature: input.signatureHeader,
      xRequestId: input.requestId,
      dataId: input.dataId,
      secret: input.secret,
    });
    return true;
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      return false;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Preference creation (task 5.1) — buildPreferenceRequest is pure and
// testable without the SDK; createMercadoPagoClient wraps the real network
// call behind the MercadoPagoClient interface below.
// ---------------------------------------------------------------------------

export interface PreferenceItemInput {
  title: string;
  quantity: number;
  unitPrice: number;
}

export interface BuildPreferenceRequestInput {
  orderId: string;
  publicCode: string;
  items: PreferenceItemInput[];
  payerEmail?: string;
  baseUrl: string;
}

/** Pure mapping from our domain order into MercadoPago's PreferenceRequest
 * shape — no network call, fully unit-testable (mercadopago.test.ts). */
export function buildPreferenceRequest(input: BuildPreferenceRequestInput): PreferenceRequest {
  const pedidoUrl = `${input.baseUrl}/pedido/${input.publicCode}`;

  return {
    items: input.items.map((item) => ({
      id: input.orderId,
      title: item.title,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      currency_id: "ARS",
    })),
    external_reference: input.orderId,
    payer: input.payerEmail ? { email: input.payerEmail } : undefined,
    back_urls: {
      success: pedidoUrl,
      pending: pedidoUrl,
      failure: pedidoUrl,
    },
    // Only meaningful together with a success back_url — auto-redirects the
    // buyer back to /pedido/{code} once payment is approved. The order's
    // actual status is still only ever set by the server-verified webhook
    // (specs/payment-mercadopago "Server-Side Payment Verification"); this
    // is purely a UX convenience.
    auto_return: "approved",
    notification_url: `${input.baseUrl}/api/webhooks/mercadopago`,
  };
}

export interface CreatePreferenceResult {
  preferenceId: string;
  initPoint: string;
}

export type MpPaymentStatus =
  | "approved"
  | "pending"
  | "in_process"
  | "rejected"
  | "cancelled"
  | (string & {});

export interface MpPayment {
  id: string;
  status: MpPaymentStatus;
  externalReference: string | null;
  transactionAmount: number;
}

/** The MP SDK boundary — everything the rest of the app needs from
 * MercadoPago, narrowed to exactly two operations so tests can inject a
 * trivial fake instead of the real network-calling SDK. */
export interface MercadoPagoClient {
  createPreference(input: BuildPreferenceRequestInput): Promise<CreatePreferenceResult>;
  getPayment(paymentId: string): Promise<MpPayment>;
}

/**
 * Real implementation, built lazily (only when actually invoked) so routes
 * can construct it without eagerly requiring MP_ACCESS_TOKEN at import
 * time — signature-rejected requests never need a client at all.
 */
export function createMercadoPagoClient(): MercadoPagoClient {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    throw new MissingMercadoPagoCredentialsError();
  }

  const config = new MercadoPagoConfig({ accessToken });
  const preferenceClient = new MpPreferenceClient(config);
  const paymentClient = new MpPaymentClient(config);

  return {
    async createPreference(input) {
      const body = buildPreferenceRequest(input);
      const response = await preferenceClient.create({ body });
      if (!response.id || !response.init_point) {
        throw new Error(
          "MercadoPago preference response is missing id/init_point — cannot redirect to checkout.",
        );
      }
      return { preferenceId: response.id, initPoint: response.init_point };
    },
    async getPayment(paymentId) {
      const response = await paymentClient.get({ id: paymentId });
      return {
        id: String(response.id ?? paymentId),
        status: (response.status ?? "unknown") as MpPaymentStatus,
        externalReference: response.external_reference ?? null,
        transactionAmount: response.transaction_amount ?? 0,
      };
    },
  };
}
