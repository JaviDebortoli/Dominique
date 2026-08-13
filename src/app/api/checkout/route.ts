// Checkout API route — thin HTTP adapter over src/modules/orders/order.service.ts
// (design.md D1: business logic lives in the module, not here).
//
// Backs specs/cart-checkout/spec.md:
//   - "Guest-Only Checkout" (no auth required to hit this route)
//   - "Stock Re-Validation at Submission" (tasks.md 4.5)
// and design.md D5 / Sequence — Stock & Reservation (tasks.md 4.6:
// Order(PENDING_PAYMENT, expiresAt=+30min) + hold() per line in one tx).
//
// MercadoPago preference creation (redirecting to init_point for the MP
// payment method) is Phase 5 scope (tasks.md 5.1) — this route only creates
// the PENDING_PAYMENT order and holds stock; the client is told the order's
// public code so it can display a confirmation / poll status.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { release } from "@/modules/inventory/stock.service";
import {
  createPendingOrder,
  EmptyCartError,
  StockUnavailableError,
  type CheckoutLine,
  type PendingOrder,
} from "@/modules/orders/order.service";
import { createMercadoPagoClient } from "@/modules/payments/mercadopago";

interface CheckoutRequestBody {
  buyerName?: unknown;
  phone?: unknown;
  email?: unknown;
  method?: unknown;
  items?: unknown;
}

interface ValidatedCheckoutRequest {
  buyerName: string;
  phone: string;
  email: string;
  method: "MP" | "PICKUP_CASH";
  items: CheckoutLine[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCheckoutLine(value: unknown): value is CheckoutLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    isNonEmptyString(line.variantId) &&
    typeof line.qty === "number" &&
    Number.isInteger(line.qty) &&
    line.qty > 0
  );
}

/**
 * Validates the raw request body shape (contact fields present, method is
 * one of the two allowed OrderMethod values, items is an array of
 * well-formed lines). Returns null when the shape itself is invalid — this
 * is separate from stock re-validation, which order.service.ts owns.
 */
function validateRequestBody(body: CheckoutRequestBody): ValidatedCheckoutRequest | null {
  if (
    !isNonEmptyString(body.buyerName) ||
    !isNonEmptyString(body.phone) ||
    !isNonEmptyString(body.email) ||
    (body.method !== "MP" && body.method !== "PICKUP_CASH") ||
    !Array.isArray(body.items) ||
    !body.items.every(isCheckoutLine)
  ) {
    return null;
  }

  return {
    buyerName: body.buyerName,
    phone: body.phone,
    email: body.email,
    method: body.method,
    items: body.items,
  };
}

/**
 * tasks.md 5.1 — creates the MercadoPago preference for a just-created
 * PENDING_PAYMENT order and responds with a real HTTP 303 to `init_point`
 * (design.md's Sequence — Payment (MercadoPago) diagram: "create
 * preference ... 303 → init_point"). A single summarized line item is used
 * (title = order's public code) rather than itemizing every product name,
 * to avoid a second product/variant lookup in this thin adapter — the
 * itemized total is still exact, just not broken out line-by-line on
 * MercadoPago's hosted checkout page.
 *
 * If preference creation fails (e.g. missing/invalid MP_ACCESS_TOKEN — the
 * current state of this repo until the owner sets up a MercadoPago
 * Developer account, or a genuine MP API outage), the order and its
 * stock hold are compensated (released + cancelled) rather than left as an
 * orphaned PENDING_PAYMENT order the customer can never actually pay for.
 */
async function createMercadoPagoRedirect(order: PendingOrder): Promise<Response> {
  const total = order.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.qty, 0);

  try {
    const mpClient = createMercadoPagoClient();
    const preference = await mpClient.createPreference({
      orderId: order.id,
      publicCode: order.publicCode,
      items: [{ title: `Pedido ${order.publicCode}`, quantity: 1, unitPrice: total }],
      payerEmail: order.email,
      baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000",
    });
    return NextResponse.redirect(preference.initPoint, 303);
  } catch (error) {
    await compensateFailedPreference(order);
    console.error("MercadoPago preference creation failed; order compensated", error);
    return NextResponse.json(
      {
        error: "mercadopago_unavailable",
        message: "No pudimos iniciar el pago con MercadoPago. Intentá de nuevo en unos minutos.",
      },
      { status: 502 },
    );
  }
}

async function compensateFailedPreference(order: PendingOrder): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      for (const item of order.items) {
        await release(tx, { variantId: item.variantId, qty: item.qty, orderId: order.id });
      }
      await tx.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED", expiresAt: null },
      });
    },
    { maxWait: 10_000, timeout: 10_000 },
  );
}

export async function POST(request: Request): Promise<Response> {
  let rawBody: CheckoutRequestBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const validated = validateRequestBody(rawBody);
  if (!validated) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const order = await createPendingOrder(prisma, validated);

    if (order.method === "MP") {
      return createMercadoPagoRedirect(order);
    }

    return NextResponse.json(
      { orderId: order.id, publicCode: order.publicCode },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof EmptyCartError) {
      return NextResponse.json({ error: "empty_cart" }, { status: 400 });
    }
    if (error instanceof StockUnavailableError) {
      return NextResponse.json(
        {
          error: "stock_unavailable",
          variantIds: error.variantIds,
          message:
            "Alguno de los talles seleccionados ya no está disponible. Actualizá tu carrito e intentá de nuevo.",
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
