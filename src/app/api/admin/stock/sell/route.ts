// In-store sale route ("Vender en local" — /admin/caja) — thin HTTP adapter
// over stock.service.ts's sellInStore() (design.md D1). Not covered by
// middleware.ts's matcher (see that file's module doc) — checks its own
// session. Backs specs/inventory-stock/spec.md "In-store sale reduces
// online-visible stock" and specs/admin-console/spec.md "Authenticated
// Access". tasks.md 7.1/7.7.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { OutOfStockError, sellInStore } from "@/modules/inventory/stock.service";

interface RawBody {
  variantId?: unknown;
  qty?: unknown;
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
    typeof body.qty !== "number" ||
    !Number.isInteger(body.qty) ||
    body.qty <= 0
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    await sellInStore(prisma, {
      variantId: body.variantId,
      qty: body.qty,
      actorId: session.user.id,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof OutOfStockError) {
      return NextResponse.json(
        {
          error: "out_of_stock",
          message: "No hay stock disponible para vender (puede estar reservado o ya vendido).",
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
