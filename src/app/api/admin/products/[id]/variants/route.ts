// Admin add-variant route — thin HTTP adapter over
// src/modules/catalog/product.service.ts's UNMODIFIED addVariant() (design.md
// G6) plus, optionally, one audited stock adjustment via
// stock.service.ts's adjust() — the SAME mechanism /admin/caja's manual
// reconciliation uses. addVariant() itself always creates at onHand: 0
// (its contract is unchanged); an explicit, valid, positive `onHand` in the
// request body is applied as a separate adjust() call right after, so the
// initial quantity still lands as a real StockMovement (reason
// ADJUSTMENT), not an invisible starting value. This supersedes the
// original G5 "no stock input here, ever" decision — `held` stays
// permanently blocked below (it's a derived reservation count, never
// something to hand-set), but `onHand` no longer is. Every caller-side
// concern (auth, request shape, unknown product, HTTP status) is answered
// here, in the route, not in the module.
//
// NOT covered by src/proxy.ts's matcher (deliberately — see that file's
// module doc: /api/admin/* checks its own session). Mirrors
// api/admin/products/[id]/variants/[variantId]/route.ts's `RouteContext`
// shape and api/admin/products/route.ts's DuplicateVariantError handling.
// Backs specs/admin-console/spec.md "Authenticated Access", "Owner adds a
// variant to an existing product", and "Adding a duplicate size+color
// variant is rejected". tasks.md 1.1/1.2.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addVariant, DuplicateVariantError } from "@/modules/catalog/product.service";
import { adjust } from "@/modules/inventory/stock.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RawBody {
  size?: unknown;
  color?: unknown;
  sku?: unknown;
  onHand?: unknown;
  held?: unknown;
}

interface ValidatedVariant {
  size: string;
  color: string;
  sku: string;
}

function validateBody(body: RawBody): ValidatedVariant | null {
  const size = typeof body.size === "string" ? body.size.trim() : "";
  const color = typeof body.color === "string" ? body.color.trim() : "";
  const sku = typeof body.sku === "string" ? body.sku.trim() : "";

  if (!size || !color || !sku) {
    return null;
  }

  // addVariant() itself still only ever sees size/color/sku — never
  // constructed with an `onHand` key. Any initial stock is applied
  // separately below, after creation, via adjust().
  return { size, color, sku };
}

type OnHandValidation = { ok: true; onHand: number } | { ok: false };

/** Omitted -> 0 (today's default, unchanged). Present -> must be a
 * non-negative integer; anything else is a validation failure, same as a
 * malformed size/color/sku. */
function validateOnHand(value: unknown): OnHandValidation {
  if (value === undefined) {
    return { ok: true, onHand: 0 };
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return { ok: false };
  }
  return { ok: true, onHand: value };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let rawBody: RawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // `held` is a derived reservation count (only ever written by
  // hold()/release()/commitPaid()) — reject it outright rather than
  // silently coercing or dropping it. `onHand` is validated below instead;
  // it's no longer blocked.
  if ("held" in rawBody) {
    return NextResponse.json(
      {
        error: "stock_not_editable",
        message: "El stock reservado no se edita acá.",
      },
      { status: 400 },
    );
  }

  const validated = validateBody(rawBody);
  if (!validated) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const onHandResult = validateOnHand(rawBody.onHand);
  if (!onHandResult.ok) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id: productId } = await context.params;

  // G6 — resolve the product with a PK existence read before calling
  // addVariant(), so a stale tab against a deleted product gets a 404 with
  // a real user fix instead of a raw FK-violation 500.
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }

  try {
    const variant = await addVariant(prisma, productId, {
      size: validated.size,
      color: validated.color,
      sku: validated.sku,
    });

    // Always created at 0 above; a positive onHand becomes one audited
    // adjust() call right after, so it lands as a real StockMovement
    // instead of an invisible starting value. onHand>=held (both 0 on a
    // brand-new variant) and delta>0 here, so adjust()'s own invariant
    // check can never fail for this call.
    if (onHandResult.onHand > 0) {
      await adjust(prisma, {
        variantId: variant.id,
        delta: onHandResult.onHand,
        actorId: session.user.id,
      });
    }

    return NextResponse.json(
      { id: variant.id, sku: variant.sku, size: variant.size, color: variant.color },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof DuplicateVariantError) {
      return NextResponse.json(
        {
          error: "duplicate_variant",
          message: `Ya existe una variante talle "${error.size}" color "${error.color}". Editá la existente.`,
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
