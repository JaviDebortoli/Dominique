// Staff "cancel order" route — thin HTTP adapter over
// order.service.ts's cancelOrder() (design.md D1, already exhaustively
// tested at the service level). Mirrors pickup/route.ts. Not covered by
// middleware.ts's matcher — checks its own session. Backs
// specs/order-lifecycle/spec.md's cancel scenarios (proposal
// 2026-08-18-admin-cancelar-pedido).
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  cancelOrder,
  InvalidOrderStatusTransitionError,
  OrderNotFoundError,
} from "@/modules/orders/order.service";

interface RouteContext {
  params: Promise<{ orderId: string }>;
}

// design.md Interfaces/Contracts route status map — the service throws the
// English/technical InvalidOrderStatusTransitionError (design.md "the route
// composes the Spanish copy" decision); this route branches on
// error.fromStatus to select the Spanish message shown to staff.
const PAID_BLOCKED_MESSAGE =
  "No se puede cancelar: ya está pagado. Para reembolsar, gestionalo desde MercadoPago.";
const GENERIC_BLOCKED_MESSAGE = "No se puede cancelar un pedido en este estado.";

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { orderId } = await context.params;

  try {
    const order = await cancelOrder(prisma, orderId);
    return NextResponse.json({ id: order.id, status: order.status }, { status: 200 });
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      return NextResponse.json({ error: "order_not_found" }, { status: 404 });
    }
    if (error instanceof InvalidOrderStatusTransitionError) {
      const message = error.fromStatus === "PAID" ? PAID_BLOCKED_MESSAGE : GENERIC_BLOCKED_MESSAGE;
      return NextResponse.json({ error: "invalid_transition", message }, { status: 409 });
    }
    throw error;
  }
}
