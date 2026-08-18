"use client";

// Inline row edit/delete for /admin/categorias — design.md E6: one
// "use client" component owns the whole <tr>, no modal, keeps page.tsx an
// RSC. Backs specs/admin-console/spec.md "Owner renames a category", "Slug
// key in the payload is rejected, not silently ignored", "Duplicate name
// rejected on rename", "Owner deletes an empty category", "Delete blocked
// when category has products". tasks.md 3.1/3.2.
//
// The slug cell in edit mode deliberately stays uneditable text
// (/categoria/{slug}, text-outline) — design.md's UI Shape: the owner sees,
// at the moment of renaming, that the public URL does not follow the label.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminCategoryRow } from "@/modules/catalog/category.service";

interface CategoryRowProps {
  category: AdminCategoryRow;
}

export function CategoryRow({ category }: CategoryRowProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [name, setName] = useState(category.name);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function enterEdit() {
    setName(category.name);
    setErrorMessage(null);
    setMode("edit");
  }

  function cancelEdit() {
    setName(category.name);
    setErrorMessage(null);
    setMode("view");
  }

  async function handleSave() {
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/admin/categories/${category.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setErrorMessage(body.message ?? "No pudimos guardar la categoría.");
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
      `¿Eliminar "${category.name}"? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) {
      return;
    }

    setErrorMessage(null);

    try {
      const response = await fetch(`/api/admin/categories/${category.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setErrorMessage(body.message ?? "No pudimos eliminar la categoría.");
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

  return (
    <tr className="border-b border-ink/10">
      <td className="py-2">
        {mode === "edit" ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="border border-ink/20 px-3 py-2"
          />
        ) : (
          category.name
        )}
      </td>
      <td className="py-2">
        {mode === "edit" ? (
          <span className="font-sans text-body-sm text-outline">/categoria/{category.slug}</span>
        ) : (
          category.slug
        )}
      </td>
      <td className="py-2 text-right">{category.productCount}</td>
      <td className="py-2 text-right">
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
