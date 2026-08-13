// Staff "mark picked up" route — thin HTTP adapter over
// order.service.ts's markPickedUp() (design.md D1, already exhaustively
// tested at the service level in tasks.md 6.7). Not covered by
// middleware.ts's matcher (see that file's module doc) — checks its own
// session. Backs specs/admin-console/spec.md "Order Status Management" and
// "Authenticated Access". tasks.md 7.1/7.9.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  InvalidOrderStatusTransitionError,
  markPickedUp,
  OrderNotFoundError,
} from "@/modules/orders/order.service";

interface RouteContext {
  params: Promise<{ orderId: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { orderId } = await context.params;

  try {
    const order = await markPickedUp(prisma, orderId);
    return NextResponse.json({ id: order.id, status: order.status }, { status: 200 });
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      return NextResponse.json({ error: "order_not_found" }, { status: 404 });
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
