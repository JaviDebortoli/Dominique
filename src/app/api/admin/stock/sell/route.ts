// In-store sale route ("Vender en local" — /admin/caja) — thin HTTP adapter
// over sale.service.ts's recordInStoreSale() (design.md D1), which composes
// the existing sellInStore() (stock.service.ts, unchanged) with a Sale
// write in one transaction. Not covered by middleware.ts's matcher (see
// that file's module doc) — checks its own session. Backs
// specs/inventory-stock/spec.md "In-store sale reduces online-visible
// stock", specs/admin-console/spec.md "Authenticated Access", and
// specs/sales-revenue/spec.md "In-Person Sale Recording" / "Sale rejected
// without a payment method" / "Split payment is rejected". tasks.md
// 7.1/7.7, control-de-caja tasks.md 2.4/2.5.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { OutOfStockError } from "@/modules/inventory/stock.service";
import { recordInStoreSale } from "@/modules/sales/sale.service";

const PAYMENT_METHODS = new Set(["CASH", "TRANSFER"]);

interface RawBody {
  variantId?: unknown;
  qty?: unknown;
  paymentMethod?: unknown;
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
    body.qty <= 0 ||
    typeof body.paymentMethod !== "string" ||
    !PAYMENT_METHODS.has(body.paymentMethod)
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    await recordInStoreSale(prisma, {
      variantId: body.variantId,
      qty: body.qty,
      paymentMethod: body.paymentMethod as "CASH" | "TRANSFER",
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
