// Staff "mark picked up" route — thin HTTP adapter over
// order.service.ts's markPickedUp() (design.md D1, already exhaustively
// tested at the service level in tasks.md 6.7 / control-de-caja tasks.md
// 4.1-4.2). Not covered by middleware.ts's matcher (see that file's module
// doc) — checks its own session. Backs specs/admin-console/spec.md "Order
// Status Management" and "Authenticated Access", and
// specs/order-lifecycle/spec.md "PICKUP_CASH pickup requires a
// payment-method choice". tasks.md 7.1/7.9, control-de-caja tasks.md
// 4.3/4.4.
//
// The request body is OPTIONAL: an MP order's pickup never needs a
// paymentMethod (payment already happened at the webhook), so an empty body
// must be tolerated, not treated as a parse error.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  InvalidOrderStatusTransitionError,
  markPickedUp,
  OrderNotFoundError,
  PaymentMethodRequiredError,
} from "@/modules/orders/order.service";

interface RouteContext {
  params: Promise<{ orderId: string }>;
}

const PAYMENT_METHODS = new Set(["CASH", "TRANSFER"]);

interface RawBody {
  paymentMethod?: unknown;
}

async function parseOptionalPaymentMethod(request: Request): Promise<"CASH" | "TRANSFER" | undefined> {
  const rawText = await request.text();
  if (!rawText) {
    return undefined;
  }

  let body: RawBody;
  try {
    body = JSON.parse(rawText);
  } catch {
    return undefined;
  }

  if (typeof body.paymentMethod === "string" && PAYMENT_METHODS.has(body.paymentMethod)) {
    return body.paymentMethod as "CASH" | "TRANSFER";
  }
  return undefined;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { orderId } = await context.params;
  const paymentMethod = await parseOptionalPaymentMethod(request);

  try {
    const order = await markPickedUp(prisma, orderId, { paymentMethod });
    return NextResponse.json({ id: order.id, status: order.status }, { status: 200 });
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      return NextResponse.json({ error: "order_not_found" }, { status: 404 });
    }
    if (error instanceof PaymentMethodRequiredError) {
      return NextResponse.json(
        {
          error: "payment_method_required",
          message: "Elegí Efectivo o Transferencia para marcar el retiro.",
        },
        { status: 400 },
      );
    }
    if (error instanceof InvalidOrderStatusTransitionError) {
      return NextResponse.json(
        { error: "invalid_transition", message: error.message },
        { status: 409 },
      );
    }
    throw error;
  }
}
