// Manual stock reconciliation route — thin HTTP adapter over
// stock.service.ts's adjust() (design.md D1). Not covered by middleware.ts's
// matcher (see that file's module doc) — checks its own session. Backs
// specs/inventory-stock/spec.md "Manual Admin Reconciliation" and
// specs/admin-console/spec.md "Authenticated Access". tasks.md 7.1/7.8.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { adjust, InvalidStockAdjustmentError } from "@/modules/inventory/stock.service";

interface RawBody {
  variantId?: unknown;
  delta?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: RawBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (
    typeof body.variantId !== "string" ||
    !body.variantId ||
    typeof body.delta !== "number" ||
    !Number.isInteger(body.delta) ||
    body.delta === 0
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    await adjust(prisma, { variantId: body.variantId, delta: body.delta, actorId: session.user.id });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof InvalidStockAdjustmentError) {
      return NextResponse.json(
        {
          error: "invalid_adjustment",
          message: "Ese ajuste dejaría el stock disponible por debajo de lo reservado o de cero.",
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
