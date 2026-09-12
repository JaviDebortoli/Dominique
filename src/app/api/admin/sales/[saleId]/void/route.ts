// Staff "Anular" route — thin HTTP adapter over sale.service.ts's
// voidSale() (design.md D1, already exhaustively tested at the service
// level in tasks.md Phase 3). Not covered by middleware.ts's matcher (see
// that file's module doc) — checks its own session. Backs
// specs/sales-revenue/spec.md "Sale Voiding (Anular)" and
// specs/admin-console/spec.md "Authenticated Access". control-de-caja
// tasks.md 3.6/3.7.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  SaleAlreadyVoidedError,
  SaleNotFoundError,
  SaleVoidWindowClosedError,
  voidSale,
} from "@/modules/sales/sale.service";

interface RouteContext {
  params: Promise<{ saleId: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { saleId } = await context.params;

  try {
    const sale = await voidSale(prisma, { saleId, actorId: session.user.id });
    return NextResponse.json({ id: sale.id, voidedAt: sale.voidedAt }, { status: 200 });
  } catch (error) {
    if (error instanceof SaleNotFoundError) {
      return NextResponse.json({ error: "sale_not_found" }, { status: 404 });
    }
    if (error instanceof SaleAlreadyVoidedError) {
      return NextResponse.json(
        { error: "already_voided", message: "Esta venta ya fue anulada." },
        { status: 409 },
      );
    }
    if (error instanceof SaleVoidWindowClosedError) {
      return NextResponse.json(
        {
          error: "void_window_closed",
          message:
            "Esta venta no es de hoy y ya no se puede anular. Corregí el stock con un Ajuste.",
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
