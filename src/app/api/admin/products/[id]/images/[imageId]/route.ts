// Admin delete-image route — thin HTTP adapter over
// src/modules/catalog/product.service.ts's deleteImage() (design.md G4).
// Mirrors api/admin/products/[id]/variants/[variantId]/route.ts's
// RouteContext shape.
//
// NOT covered by src/proxy.ts's matcher (deliberately — see that file's
// module doc: /api/admin/* checks its own session). The `id` segment is NOT
// re-validated against `image.productId` (design.md G4 — a cuid PK fully
// identifies the row; the nested path states ownership to a reader, not an
// enforced constraint). Backs specs/admin-console/spec.md "Authenticated
// Access" and "Owner deletes an image, including the last remaining one".
// tasks.md 6.3/6.4.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteImage, ProductImageNotFoundError } from "@/modules/catalog/product.service";

interface RouteContext {
  params: Promise<{ id: string; imageId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { imageId } = await context.params;

  try {
    await deleteImage(prisma, imageId);
    return NextResponse.json({ id: imageId }, { status: 200 });
  } catch (error) {
    if (error instanceof ProductImageNotFoundError) {
      return NextResponse.json({ error: "image_not_found" }, { status: 404 });
    }
    throw error;
  }
}
