// Admin add-variant route — thin HTTP adapter over
// src/modules/catalog/product.service.ts's UNMODIFIED addVariant() (design.md
// G5/G6). addVariant() itself is already validated and unit-tested; every
// caller-side concern (auth, request shape, unknown product, HTTP status)
// is answered here, in the route, not in the module.
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

  // G5 — structurally never construct an `onHand` property on the object
  // passed to addVariant(); this object literal has no such key.
  return { size, color, sku };
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

  // G5 — reject any onHand/held key outright rather than silently coercing
  // or dropping it; a new variant always starts at onHand: 0 via
  // addVariant()'s own `onHand ?? 0` default.
  if ("onHand" in rawBody || "held" in rawBody) {
    return NextResponse.json(
      {
        error: "stock_not_editable",
        message: "El stock no se edita acá. Cargalo desde /admin/caja.",
      },
      { status: 400 },
    );
  }

  const validated = validateBody(rawBody);
  if (!validated) {
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
