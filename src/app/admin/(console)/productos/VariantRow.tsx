"use client";

// Inline sub-row edit/delete for a product's variants, mounted by
// ProductRow.tsx's disclosure (design.md F9 — the "Variantes" count is the
// disclosure control). Mirrors CategoryRow.tsx's shape: one "use client"
// component owns its whole <tr>, no modal, keeps page.tsx an RSC. Backs
// specs/admin-console/spec.md "Owner edits a variant's SKU", "Duplicate SKU
// rejected on variant edit", "Variant size/color immutable after first
// sale", "Owner deletes a clean variant", "Variant delete blocked by
// order/stock history", "Variant delete blocked by remaining stock",
// "Variant delete blocked as the product's last remaining variant".
// tasks.md 4.1/4.2.
//
// design.md F7: onHand/held are never editable here — there is no input
// for them, structurally. View mode renders as an annotation of the
// product row (no top border, SKU in text-outline text-body-sm) per
// design.md's UI Shape, not a peer row.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Variant } from "@/generated/prisma/client";

interface VariantRowProps {
  productId: string;
  variant: Variant;
}

export function VariantRow({ productId, variant }: VariantRowProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [sku, setSku] = useState(variant.sku);
  const [size, setSize] = useState(variant.size);
  const [color, setColor] = useState(variant.color);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function enterEdit() {
    setSku(variant.sku);
    setSize(variant.size);
    setColor(variant.color);
    setErrorMessage(null);
    setMode("edit");
  }

  function cancelEdit() {
    setSku(variant.sku);
    setSize(variant.size);
    setColor(variant.color);
    setErrorMessage(null);
    setMode("view");
  }

  async function handleSave() {
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/admin/products/${productId}/variants/${variant.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sku, size, color }),
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setErrorMessage(body.message ?? "No pudimos guardar la variante.");
        setSubmitting(false);
        return;
      }

      setSubmitting(false);
      setMode("view");
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Error inesperado.");
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      `¿Eliminar la variante "${variant.sku}"? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) {
      return;
    }

    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/admin/products/${productId}/variants/${variant.id}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setErrorMessage(body.message ?? "No pudimos eliminar la variante.");
        return;
      }

      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Error inesperado.");
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      cancelEdit();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void handleSave();
    }
  }

  const inputClassName = "border border-ink/20 px-2 py-1 text-body-sm";

  return (
    <tr className="border-b-0">
      <td className="py-1 pl-6">
        {mode === "edit" ? (
          <label className="flex flex-col gap-1 text-body-sm text-ink">
            SKU
            <input
              autoFocus
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              onKeyDown={handleKeyDown}
              className={inputClassName}
            />
          </label>
        ) : (
          <span className="font-sans text-body-sm text-outline">{variant.sku}</span>
        )}
      </td>
      <td className="py-1">
        {mode === "edit" ? (
          <label className="flex flex-col gap-1 text-body-sm text-ink">
            Talle
            <input
              value={size}
              onChange={(e) => setSize(e.target.value)}
              onKeyDown={handleKeyDown}
              className={inputClassName}
            />
          </label>
        ) : (
          <span className="font-sans text-body-sm text-outline">{variant.size}</span>
        )}
      </td>
      <td className="py-1">
        {mode === "edit" ? (
          <label className="flex flex-col gap-1 text-body-sm text-ink">
            Color
            <input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              onKeyDown={handleKeyDown}
              className={inputClassName}
            />
          </label>
        ) : (
          <span className="font-sans text-body-sm text-outline">{variant.color}</span>
        )}
      </td>
      <td className="py-1 text-right" colSpan={2}>
        <div className="flex flex-col items-end gap-1">
          <div className="flex justify-end gap-4">
            {mode === "edit" ? (
              <>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleSave()}
                  className="font-sans text-label-caps uppercase tracking-widest text-ink disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="font-sans text-label-caps uppercase tracking-widest text-ink"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={enterEdit}
                  className="font-sans text-label-caps uppercase tracking-widest text-ink"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="font-sans text-label-caps uppercase tracking-widest text-red-700"
                >
                  Eliminar
                </button>
              </>
            )}
          </div>
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
