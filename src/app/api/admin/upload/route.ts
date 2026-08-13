// Admin image upload route — design.md Threat Matrix row "Documentation
// -like / executable-file classification" (design.md's ONLY "Applicable"
// threat matrix row targeting the app's own code, besides the webhook
// intake row): "Allow-list image/jpeg,png,webp by magic bytes (not
// extension), re-encode via sharp, random filename, [served with] no
// script execution".
//
// Security model (tasks.md 7.4/7.5) — in order, ALL of which run before a
// single byte is ever written to disk:
//   1. Auth check (this route is NOT covered by middleware.ts's matcher —
//      see that file's module doc — so it checks its own session).
//   2. Read the raw bytes. The client-declared filename and Content-Type
//      are NEVER trusted for classification — only used for now.
//   3. Sniff the REAL file type from the actual magic bytes via `file-type`
//      (a magic-byte sniffer, not an extension/mimetype lookup). A `.svg`/
//      `.html`/`.php` file, or a non-image file renamed+relabeled to look
//      like a JPEG, has no image magic number and is rejected here.
//   4. Allow-list the sniffed MIME to EXACTLY image/jpeg, image/png,
//      image/webp. Anything else (including a technically-valid image
//      format not on this list, e.g. GIF/SVG/TIFF/AVIF) is rejected.
//   5. Re-encode via `sharp` — this fully decodes the pixel data and
//      re-serializes a brand-new file in the same format, which strips any
//      embedded scripting/metadata/polyglot payload the original bytes
//      might have carried beyond legitimate pixel data (a "magic-byte
//      allow-listed" file can still be a crafted polyglot; re-encoding is
//      what actually neutralizes that, not the allow-list alone). A file
//      that sniffs as an allowed image type but fails to fully decode
//      (corrupt/truncated) throws here and is rejected too.
//   6. Generate a random filename (crypto.randomUUID(), never the
//      client-supplied name) with the extension matching the SNIFFED type.
//   7. Write to the local uploads directory (dev-adapted from design.md D8
//      — see below) — the FIRST disk write in this whole handler.
//
// D8 production-vs-dev note: design.md specifies VPS disk storage under
// `/var/dominique/uploads`, served by Nginx `alias` with
// `default_type application/octet-stream` (no script execution) — that
// Nginx config is Phase 8 (deploy/nginx.conf) scope. For local dev (this
// repo has no Nginx in front of `next dev`/`next start`), this route writes
// under `public/uploads/products/` instead, which Next.js serves as a
// static file with no server-side script execution of its own — the same
// "no script execution capability" property D8 asks for, achieved via
// Next's static file serving rather than an Nginx alias. A real deploy
// switches this constant to `/var/dominique/uploads` per D8 (see the
// UPLOAD_DIR comment below) and relies on deploy/nginx.conf for serving.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { auth } from "@/lib/auth";

// Magic-byte-sniffed MIME allow-list (design.md: "image/jpeg,png,webp").
// Keys are file-type's detected MIME; values are the extension this route
// stores the re-encoded file under — deliberately NOT derived from the
// client's filename.
const ALLOWED_TYPES: Record<string, { extension: string; sharpFormat: "jpeg" | "png" | "webp" }> = {
  "image/jpeg": { extension: "jpg", sharpFormat: "jpeg" },
  "image/png": { extension: "png", sharpFormat: "png" },
  "image/webp": { extension: "webp", sharpFormat: "webp" },
};

// D8: `/var/dominique/uploads` in production (see this file's module doc
// for the local-dev adaptation rationale). `public/` is Next.js's
// static-asset root, so a file written here is immediately servable at
// `/uploads/products/<name>` with zero extra routing code.
//
// tasks.md 8.1 — `UPLOAD_DIR` env var (documented in .env.example and
// deploy/DEPLOY.md) closes the loop with deploy/nginx.conf's `/uploads/`
// `alias`: when set (production), files are written under
// `$UPLOAD_DIR/products` instead of `public/uploads/products`. The URL
// returned to the client is ALWAYS `/uploads/products/<name>` either way —
// only the on-disk write location changes — because Nginx's alias (not this
// route) is what maps that public path to the real directory in production.
// Read lazily (not as a module-level constant) so tests can set/unset
// `process.env.UPLOAD_DIR` per-case without needing `vi.resetModules()`.
function resolveUploadDir(): string {
  const overrideRoot = process.env.UPLOAD_DIR;
  return overrideRoot
    ? path.join(overrideRoot, "products")
    : path.join(process.cwd(), "public", "uploads", "products");
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Step 3: sniff the ACTUAL bytes. file-type reads magic numbers/file
  // signatures — it does not look at file.name or file.type at all, which
  // is exactly why it defeats a JPEG-renamed-HTML (or any other
  // extension/Content-Type spoof): HTML/SVG/PHP text has no image magic
  // number, so this returns `undefined` for all of them.
  const detected = await fileTypeFromBuffer(bytes);
  const allowed = detected ? ALLOWED_TYPES[detected.mime] : undefined;

  if (!allowed) {
    return NextResponse.json(
      {
        error: "unsupported_file_type",
        message: "Solo se aceptan imágenes JPEG, PNG o WEBP.",
      },
      { status: 415 },
    );
  }

  // Step 5: full decode + re-encode via sharp. `.toBuffer()` with no
  // `.withMetadata()` call strips EXIF/ICC/XMP and any non-pixel payload by
  // construction — sharp only round-trips actual decoded pixel data.
  let reEncoded: Buffer;
  try {
    reEncoded = await sharp(bytes).toFormat(allowed.sharpFormat).toBuffer();
  } catch {
    return NextResponse.json(
      { error: "corrupt_image", message: "No pudimos procesar la imagen." },
      { status: 422 },
    );
  }

  // Steps 6-7: only NOW, after every check has passed, does anything touch
  // disk. Filename is entirely server-generated.
  const filename = `${randomUUID()}.${allowed.extension}`;
  const uploadDir = resolveUploadDir();
  await mkdir(uploadDir, { recursive: true });
  // tasks.md 8.1 (UPLOAD_DIR): the destination is intentionally dynamic
  // (env-driven, D8) — Turbopack's build-time tracer otherwise treats a
  // runtime-computed path.join() as a signal to trace/bundle the whole
  // project's filesystem as a potential dependency. This app runs as one
  // long-lived PM2/`next start` process on a VPS (design.md "Technical
  // Approach"), not a serverless function with a trimmed per-route bundle,
  // so that tracing concern doesn't apply here — opt out explicitly rather
  // than silently accept the warning.
  await writeFile(path.join(/* turbopackIgnore: true */ uploadDir, filename), reEncoded);

  return NextResponse.json({ url: `/uploads/products/${filename}` }, { status: 201 });
}
