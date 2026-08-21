// Admin add-image route — thin HTTP adapter over
// src/modules/catalog/product.service.ts's addImage() (design.md G1-G3).
// Mirrors api/admin/products/[id]/variants/route.ts's RouteContext shape
// and error handling.
//
// NOT covered by src/proxy.ts's matcher (deliberately — see that file's
// module doc: /api/admin/* checks its own session). Backs
// specs/admin-console/spec.md "Authenticated Access", "Owner adds an image
// to an existing product", and "Adding a 6th image is rejected". tasks.md
// 6.1/6.2.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addImage, ProductNotFoundError, TooManyImagesError } from "@/modules/catalog/product.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RawBody {
  url?: unknown;
  altText?: unknown;
  position?: unknown;
}

interface ValidatedImage {
  url: string;
  altText?: string;
  position?: number;
}

function validateBody(body: RawBody): ValidatedImage | null {
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return null;
  }

  const validated: ValidatedImage = { url };

  if (typeof body.altText === "string" && body.altText.trim()) {
    validated.altText = body.altText.trim();
  }

  if ("position" in body) {
    const position = body.position;
    if (typeof position !== "number" || !Number.isFinite(position) || position < 0) {
      return null;
    }
    validated.position = position;
  }

  return validated;
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

  const validated = validateBody(rawBody);
  if (!validated) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id: productId } = await context.params;

  try {
    const image = await addImage(prisma, productId, {
      url: validated.url,
      altText: validated.altText,
      position: validated.position,
    });
    return NextResponse.json(
      { id: image.id, url: image.url, altText: image.altText, position: image.position },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ProductNotFoundError) {
      return NextResponse.json({ error: "product_not_found" }, { status: 404 });
    }
    if (error instanceof TooManyImagesError) {
      return NextResponse.json(
        {
          error: "too_many_images",
          message: "Máximo 5 imágenes por producto. Eliminá una antes de subir otra.",
          currentCount: error.currentCount,
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
