// MercadoPago webhook route — the untrusted entry point (design.md's File
// Changes table). Thin HTTP adapter: extracts `data.id`/`x-signature`/
// `x-request-id` from the request, delegates everything else to
// webhook.service.ts, and maps its outcome to an HTTP status.
//
// Backs specs/payment-mercadopago/spec.md and design.md's Threat Matrix row
// "Untrusted webhook intake". The request BODY IS NEVER PARSED for
// business logic — see webhook.service.ts's module doc for why that is the
// actual security mechanism, not an oversight.
//
// tasks.md 5.2/5.3.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createMercadoPagoClient } from "@/modules/payments/mercadopago";
import { processMercadoPagoWebhook } from "@/modules/payments/webhook.service";

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // MercadoPago appends `data.id` to the notification_url as a query
  // parameter (the value the x-signature manifest actually covers) — this
  // is separate from (and, unlike) the JSON body's `data.id`, which is
  // never read here.
  const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  const signatureHeader = request.headers.get("x-signature");
  const requestId = request.headers.get("x-request-id");
  const webhookSecret = process.env.MP_WEBHOOK_SECRET ?? "";

  const outcome = await processMercadoPagoWebhook({
    prisma,
    // Lazy: only constructed after webhook.service.ts's signature check
    // passes, so a rejected/forged request never requires MP_ACCESS_TOKEN
    // to be configured at all.
    getMpClient: createMercadoPagoClient,
    webhookSecret,
    signatureHeader,
    requestId,
    dataId,
  });

  switch (outcome.kind) {
    case "invalid_signature":
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    case "missing_data_id":
      return NextResponse.json({ error: "missing_data_id" }, { status: 400 });
    case "order_not_found":
      // A verified, server-refetched payment has no matching Order
      // (deleted/expired/mistyped external_reference) — money may have
      // moved with zero trace anywhere else in the app. Still answer 200
      // (design.md: never make MercadoPago retry), but this MUST be logged
      // so it's queryable instead of only discoverable by manually diffing
      // the MercadoPago dashboard against the orders table.
      console.error("[mercadopago webhook] order_not_found", { orderId: outcome.orderId });
      return new NextResponse(null, { status: 200 });
    case "ignored_status":
      // A payment status this app deliberately takes no action on (e.g.
      // "authorized") — expected, but worth a trace in case it turns out to
      // matter later.
      console.warn("[mercadopago webhook] ignored_status", { orderId: outcome.orderId, status: outcome.status });
      return new NextResponse(null, { status: 200 });
    case "approved":
      if (outcome.duplicate) {
        // A redelivery of a notification already processed (idempotency
        // guard held) — harmless, but silent duplicates are worth a trace
        // to distinguish "MP retried" from "someone re-sent this".
        console.warn("[mercadopago webhook] duplicate approved notification", { orderId: outcome.orderId });
      }
      return new NextResponse(null, { status: 200 });
    default:
      // rejected / pending — normal terminal outcomes, nothing to log.
      return new NextResponse(null, { status: 200 });
  }
}
