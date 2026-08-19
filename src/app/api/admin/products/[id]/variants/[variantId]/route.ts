// Admin variant edit/delete route — thin HTTP adapter over
// src/modules/catalog/product.service.ts's updateVariant()/deleteVariant()
// (design.md D1, F4-F8). Mirrors api/admin/products/[id]/route.ts and
// api/admin/categories/[id]/route.ts's `RouteContext` shape.
//
// NOT covered by src/proxy.ts's matcher (deliberately — see that file's
// module doc: /api/admin/* checks its own session). The `variantId`
// segment is NOT re-validated against `id` (design.md F8 — a cuid PK fully
// identifies the row; the nested path states ownership to a reader, not an
// enforced constraint). Backs specs/admin-console/spec.md "Authenticated
// Access" and "Product and Variant Management". tasks.md 3.1/3.2.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  deleteVariant,
  DuplicateSkuError,
  DuplicateVariantError,
  LastVariantError,
  updateVariant,
  VariantAttributesImmutableError,
  VariantHasHistoryError,
  VariantHasStockError,
  VariantNotFoundError,
  type UpdateVariantInput,
} from "@/modules/catalog/product.service";

interface RouteContext {
  params: Promise<{ id: string; variantId: string }>;
}

interface RawPatchBody {
  onHand?: unknown;
  held?: unknown;
  sku?: unknown;
  size?: unknown;
  color?: unknown;
}

function validatePatchBody(body: RawPatchBody): UpdateVariantInput | null {
  const hasWritableKey = "sku" in body || "size" in body || "color" in body;
  if (!hasWritableKey) return null;

  const input: UpdateVariantInput = {};

  for (const key of ["sku", "size", "color"] as const) {
    if (key in body) {
      const value = typeof body[key] === "string" ? (body[key] as string).trim() : "";
      if (!value) return null;
      input[key] = value;
    }
  }

  return input;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let rawBody: RawPatchBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if ("onHand" in rawBody || "held" in rawBody) {
    return NextResponse.json(
      {
        error: "stock_not_editable",
        message: "El stock no se edita acá. Ajustalo desde /admin/caja.",
      },
      { status: 400 },
    );
  }

  const validated = validatePatchBody(rawBody);
  if (!validated) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { variantId } = await context.params;

  try {
    const variant = await updateVariant(prisma, variantId, validated);
    return NextResponse.json(
      { id: variant.id, sku: variant.sku, size: variant.size, color: variant.color },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof VariantAttributesImmutableError) {
      return NextResponse.json(
        {
          error: "variant_attributes_immutable",
          message: `No se puede cambiar talle/color: esta variante ya tiene ${error.orderItemCount} venta(s) registrada(s).`,
          orderItemCount: error.orderItemCount,
        },
        { status: 409 },
      );
    }
    if (error instanceof DuplicateVariantError) {
      return NextResponse.json(
        { error: "duplicate_variant", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof DuplicateSkuError) {
      return NextResponse.json(
        {
          error: "duplicate_sku",
          message: `Ya existe una variante con el SKU "${error.sku}".`,
        },
        { status: 409 },
      );
    }
    if (error instanceof VariantNotFoundError) {
      return NextResponse.json({ error: "variant_not_found" }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { variantId } = await context.params;

  try {
    await deleteVariant(prisma, variantId);
    return NextResponse.json({ id: variantId }, { status: 200 });
  } catch (error) {
    if (error instanceof LastVariantError) {
      return NextResponse.json(
        {
          error: "last_variant",
          message: "No se puede eliminar la última variante. Eliminá el producto entero si ya no lo vendés.",
        },
        { status: 409 },
      );
    }
    if (error instanceof VariantHasStockError) {
      return NextResponse.json(
        {
          error: "variant_has_stock",
          message: `No se puede eliminar: todavía hay unidades en stock (${error.sku}). Ajustá el stock a 0 desde Caja y volvé a intentar.`,
          onHand: error.onHand,
        },
        { status: 409 },
      );
    }
    if (error instanceof VariantHasHistoryError) {
      return NextResponse.json(
        {
          error: "variant_has_history",
          message: `No se puede eliminar: tiene ${error.orderItemCount} venta(s) y ${error.stockMovementCount} movimiento(s) de stock registrados. Editalo en lugar de borrarlo, o dejá de reponerlo.`,
          orderItemCount: error.orderItemCount,
          stockMovementCount: error.stockMovementCount,
        },
        { status: 409 },
      );
    }
    if (error instanceof VariantNotFoundError) {
      return NextResponse.json({ error: "variant_not_found" }, { status: 404 });
    }
    throw error;
  }
}
