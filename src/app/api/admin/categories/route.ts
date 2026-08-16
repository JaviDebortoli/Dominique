// Admin category-creation route — thin HTTP adapter over
// src/modules/catalog/category.service.ts (design.md D1: business logic
// lives in the module, not here — the same pattern app/api/admin/products/
// route.ts already follows).
//
// NOT covered by src/proxy.ts's matcher (deliberately — see that file's
// module doc: /api/admin/* checks its own session so it can return a JSON
// 401 instead of an HTML redirect a fetch()-based admin UI can't usefully
// follow). Backs specs/admin-console/spec.md "Authenticated Access" and
// "Product and Variant Management". tasks.md 3.1/3.2.
import { NextResponse } from "next/server";
import { isValidSlug } from "@/lib/slugify";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createCategory,
  DuplicateCategorySlugError,
  type CreateCategoryInput,
} from "@/modules/catalog/category.service";

interface RawBody {
  name?: unknown;
  slug?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateBody(body: RawBody): CreateCategoryInput | null {
  if (!isNonEmptyString(body.name) || !isNonEmptyString(body.slug)) {
    return null;
  }

  return {
    name: body.name.trim(),
    slug: body.slug.trim(),
  };
}

export async function POST(request: Request): Promise<Response> {
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

  const validated = validateBody(rawBody);
  if (!validated) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!isValidSlug(validated.slug)) {
    return NextResponse.json(
      {
        error: "invalid_slug",
        message: "El slug solo puede tener minúsculas, números y guiones simples (sin espacios ni acentos).",
      },
      { status: 400 },
    );
  }

  try {
    const category = await createCategory(prisma, validated);
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateCategorySlugError) {
      return NextResponse.json(
        { error: "duplicate_slug", message: "Ya existe una categoría con esta URL." },
        { status: 409 },
      );
    }
    throw error;
  }
}
