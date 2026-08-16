// Admin product-creation route — thin HTTP adapter over
// src/modules/catalog/product.service.ts (design.md D1: business logic
// lives in the module, not here — the same pattern app/api/checkout/route.ts
// already follows).
//
// NOT covered by src/proxy.ts's matcher (deliberately — see that file's
// module doc: /api/admin/* checks its own session so it can return a JSON
// 401 instead of an HTML redirect a fetch()-based admin UI can't usefully
// follow). Backs specs/admin-console/spec.md "Authenticated Access" and
// "Product and Variant Management". tasks.md 7.1/7.3.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createProduct,
  DuplicateVariantError,
  type CreateProductImageInput,
  type CreateProductInput,
  type CreateProductVariantInput,
} from "@/modules/catalog/product.service";

interface RawBody {
  name?: unknown;
  slug?: unknown;
  description?: unknown;
  price?: unknown;
  categoryId?: unknown;
  variants?: unknown;
  images?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isVariant(value: unknown): value is CreateProductVariantInput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isNonEmptyString(v.size) &&
    isNonEmptyString(v.color) &&
    isNonEmptyString(v.sku) &&
    (v.priceOverride === undefined || typeof v.priceOverride === "number") &&
    (v.onHand === undefined || (typeof v.onHand === "number" && Number.isInteger(v.onHand) && v.onHand >= 0))
  );
}

function isImage(value: unknown): value is CreateProductImageInput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return isNonEmptyString(v.url) && (v.altText === undefined || typeof v.altText === "string");
}

function validateBody(body: RawBody): CreateProductInput | null {
  if (
    !isNonEmptyString(body.name) ||
    !isNonEmptyString(body.slug) ||
    typeof body.price !== "number" ||
    body.price < 0 ||
    !isNonEmptyString(body.categoryId) ||
    !Array.isArray(body.variants) ||
    body.variants.length === 0 ||
    !body.variants.every(isVariant)
  ) {
    return null;
  }
  if (body.images !== undefined && (!Array.isArray(body.images) || !body.images.every(isImage))) {
    return null;
  }

  return {
    name: body.name,
    slug: body.slug,
    description: typeof body.description === "string" ? body.description : undefined,
    price: body.price,
    categoryId: body.categoryId,
    variants: body.variants,
    images: body.images as CreateProductImageInput[] | undefined,
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

  try {
    const product = await createProduct(prisma, validated);
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateVariantError) {
      return NextResponse.json({ error: "duplicate_variant", message: error.message }, { status: 409 });
    }
    throw error;
  }
}
