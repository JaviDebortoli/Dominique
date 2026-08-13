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
    default:
      // approved / rejected / pending / duplicate / order_not_found /
      // ignored_status — always 200 once the signature is verified, so
      // MercadoPago stops retrying (design.md: "always answer 200 after
      // persisting").
      return new NextResponse(null, { status: 200 });
  }
}
