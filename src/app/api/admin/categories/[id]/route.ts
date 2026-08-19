// Admin category edit/delete route — thin HTTP adapter over
// src/modules/catalog/category.service.ts's renameCategory()/
// deleteCategory() (design.md D1: business logic lives in the module, not
// here — the same pattern api/admin/categories/route.ts already follows).
//
// NOT covered by src/proxy.ts's matcher (deliberately — see that file's
// module doc: /api/admin/* checks its own session so it can return a JSON
// 401 instead of an HTML redirect a fetch()-based admin UI can't usefully
// follow). Mirrors api/admin/orders/[orderId]/pickup/route.ts's
// `RouteContext` shape. Backs specs/admin-console/spec.md "Authenticated
// Access" and "Product and Variant Management". tasks.md 2.1/2.2.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  CategoryHasProductsError,
  CategoryNotFoundError,
  deleteCategory,
  DuplicateCategoryNameError,
  renameCategory,
} from "@/modules/catalog/category.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RawPatchBody {
  name?: unknown;
  slug?: unknown;
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
        message: "La URL de la categoría no se puede modificar.",
      },
      { status: 400 },
    );
  }

  const name = typeof rawBody.name === "string" ? rawBody.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id } = await context.params;

  try {
    const category = await renameCategory(prisma, id, { name });
    return NextResponse.json(
      { id: category.id, name: category.name, slug: category.slug },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof DuplicateCategoryNameError) {
      return NextResponse.json(
        { error: "duplicate_name", message: `Ya existe una categoría llamada "${name}".` },
        { status: 409 },
      );
    }
    if (error instanceof CategoryNotFoundError) {
      return NextResponse.json({ error: "category_not_found" }, { status: 404 });
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
    await deleteCategory(prisma, id);
    return NextResponse.json({ id }, { status: 200 });
  } catch (error) {
    if (error instanceof CategoryHasProductsError) {
      return NextResponse.json(
        {
          error: "category_has_products",
          message: `No se puede eliminar: tiene ${error.productCount} producto(s) asignados. Reasigná esos productos primero.`,
          productCount: error.productCount,
        },
        { status: 409 },
      );
    }
    if (error instanceof CategoryNotFoundError) {
      return NextResponse.json({ error: "category_not_found" }, { status: 404 });
    }
    throw error;
  }
}
