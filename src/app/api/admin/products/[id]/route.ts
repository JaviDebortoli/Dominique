// Admin product edit/delete route — thin HTTP adapter over
// src/modules/catalog/product.service.ts's updateProduct()/deleteProduct()
// (design.md D1: business logic lives in the module, not here — the same
// pattern api/admin/categories/[id]/route.ts already follows).
//
// NOT covered by src/proxy.ts's matcher (deliberately — see that file's
// module doc: /api/admin/* checks its own session so it can return a JSON
// 401 instead of an HTML redirect a fetch()-based admin UI can't usefully
// follow). Mirrors api/admin/categories/[id]/route.ts's `RouteContext`
// shape. Backs specs/admin-console/spec.md "Authenticated Access" and
// "Product and Variant Management". tasks.md 2.1/2.2.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  deleteProduct,
  ProductCategoryNotFoundError,
  ProductHasHistoryError,
  ProductHasStockError,
  ProductNotFoundError,
  updateProduct,
  type UpdateProductInput,
} from "@/modules/catalog/product.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RawPatchBody {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  price?: unknown;
  categoryId?: unknown;
}

function validatePatchBody(body: RawPatchBody): UpdateProductInput | null {
  const hasWritableKey =
    "name" in body || "description" in body || "price" in body || "categoryId" in body;
  if (!hasWritableKey) return null;

  const input: UpdateProductInput = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return null;
    input.name = name;
  }

  if ("description" in body) {
    if (body.description !== null && typeof body.description !== "string") return null;
    input.description = body.description;
  }

  if ("price" in body) {
    if (typeof body.price !== "number" || !Number.isFinite(body.price) || body.price < 0) {
      return null;
    }
    input.price = body.price;
  }

  if ("categoryId" in body) {
    const categoryId = typeof body.categoryId === "string" ? body.categoryId.trim() : "";
    if (!categoryId) return null;
    input.categoryId = categoryId;
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

  if ("slug" in rawBody) {
    return NextResponse.json(
      {
        error: "slug_immutable",
        message: "La URL del producto no se puede modificar.",
      },
      { status: 400 },
    );
  }

  const validated = validatePatchBody(rawBody);
  if (!validated) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id } = await context.params;

  try {
    const product = await updateProduct(prisma, id, validated);
    return NextResponse.json(
      {
        id: product.id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        price: Number(product.price),
        categoryId: product.categoryId,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof ProductCategoryNotFoundError) {
      return NextResponse.json(
        {
          error: "invalid_category",
          message: "La categoría seleccionada ya no existe. Recargá la página e intentá de nuevo.",
        },
        { status: 400 },
      );
    }
    if (error instanceof ProductNotFoundError) {
      return NextResponse.json({ error: "product_not_found" }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    await deleteProduct(prisma, id);
    return NextResponse.json({ id }, { status: 200 });
  } catch (error) {
    if (error instanceof ProductHasStockError) {
      return NextResponse.json(
        {
          error: "product_has_stock",
          message: `No se puede eliminar: todavía hay unidades en stock (${error.skus.join(", ")}). Ajustá el stock a 0 desde Caja y volvé a intentar.`,
          skus: error.skus,
        },
        { status: 409 },
      );
    }
    if (error instanceof ProductHasHistoryError) {
      return NextResponse.json(
        {
          error: "product_has_history",
          message: `No se puede eliminar: tiene ${error.orderItemCount} venta(s) y ${error.stockMovementCount} movimiento(s) de stock registrados. Editalo en lugar de borrarlo, o dejá de reponerlo.`,
          orderItemCount: error.orderItemCount,
          stockMovementCount: error.stockMovementCount,
        },
        { status: 409 },
      );
    }
    if (error instanceof ProductNotFoundError) {
      return NextResponse.json({ error: "product_not_found" }, { status: 404 });
    }
    throw error;
  }
}
