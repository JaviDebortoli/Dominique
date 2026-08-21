"use client";

// Inline image gallery, mounted by ProductRow.tsx's disclosure (design.md
// G9) as its own full-width row after AddVariantForm. Mirrors
// VariantRow.tsx/AddVariantForm.tsx's shape: own fetch, own submitting
// flag, own role="alert" message, router.refresh() on success,
// window.confirm() before delete. Backs specs/admin-console/spec.md "Owner
// adds an image to an existing product" and "Owner deletes an image,
// including the last remaining one". tasks.md 7.1/7.2.
//
// design.md G2: the 5-image cap is enforced server-side in addImage(); the
// disabled file input here is feedback only, so a stale tab still gets a
// real 409 from the server. design.md G8: upload stays a two-step client
// flow (POST /api/admin/upload -> POST .../images). If the ATTACH step
// fails after a successful upload, the file input resets via a `key` bump
// (so the picker is genuinely empty) instead of retrying with the
// already-returned url — see design.md's rationale for rejecting a
// URL-reuse retry.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProductImage } from "@/generated/prisma/client";

interface ProductImagesProps {
  productId: string;
  images: ProductImage[];
}

const MAX_IMAGES = 5;

export function ProductImages({ productId, images }: ProductImagesProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  async function handleDelete(image: ProductImage) {
    const confirmed = window.confirm(
      `¿Eliminar la imagen ${image.position + 1}? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) {
      return;
    }

    setErrorMessage(null);

    try {
      const response = await fetch(`/api/admin/products/${productId}/images/${image.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setErrorMessage(body.message ?? "No pudimos eliminar la imagen.");
        return;
      }

      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Error inesperado.");
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploading(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.set("file", file);
      const uploadResponse = await fetch("/api/admin/upload", { method: "POST", body: formData });

      if (!uploadResponse.ok) {
        const body = await uploadResponse.json().catch(() => ({}));
        setErrorMessage(body.message ?? "No pudimos subir la imagen.");
        setUploading(false);
        setFileInputKey((key) => key + 1);
        return;
      }

      const { url } = await uploadResponse.json();

      const attachResponse = await fetch(`/api/admin/products/${productId}/images`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });

      // G8 — attach failed after a successful upload: reset the picker via
      // a key bump instead of retrying with the already-returned url.
      if (!attachResponse.ok) {
        setErrorMessage("Subimos la imagen pero no pudimos adjuntarla. Elegí el archivo otra vez.");
        setUploading(false);
        setFileInputKey((key) => key + 1);
        return;
      }

      setUploading(false);
      setFileInputKey((key) => key + 1);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Error inesperado.");
      setUploading(false);
      setFileInputKey((key) => key + 1);
    }
  }

  const atCap = images.length >= MAX_IMAGES;

  return (
    <tr className="border-b-0">
      <td className="py-2 pl-6" colSpan={6}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-4">
            {images.map((image) => (
              <div key={image.id} className="flex flex-col items-center gap-1">
                {/* Admin-uploaded local files (design.md D8), not a
                    configured remote image domain — mirrors
                    ProductCard.tsx's same rule. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={image.altText ?? ""}
                  className="h-16 w-16 border border-ink/10 object-cover"
                />
                <button
                  type="button"
                  onClick={() => void handleDelete(image)}
                  className="font-sans text-label-caps uppercase tracking-widest text-red-700"
                >
                  Eliminar
                </button>
              </div>
            ))}
            <label className="flex flex-col items-center gap-1 text-body-sm text-ink">
              Subir imagen
              <input
                key={fileInputKey}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={atCap || uploading}
                onChange={(e) => void handleFileChange(e)}
              />
            </label>
          </div>
          {atCap ? (
            <span className="font-sans text-body-sm text-outline">Máximo 5 imágenes.</span>
          ) : null}
          {errorMessage ? (
            <p role="alert" className="font-sans text-body-sm text-red-700">
              {errorMessage}
            </p>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
