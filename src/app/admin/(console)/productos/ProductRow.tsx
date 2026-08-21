"use client";

// Owns the whole <tr> for one product row in /admin/productos (design.md
// F9). View mode renders the existing cells plus an Acciones column
// (Editar/Eliminar); the "Variantes" count cell IS the disclosure control —
// clicking it toggles rendering of one VariantRow.tsx sub-row per variant
// (F9 — reuses the existing count cell instead of a separate toggle
// affordance). Edit mode replaces the row with a single full-width
// <td colSpan={6}> form row: four fields (name/price/categoryId/
// description) don't fit E6's single-input cell pattern. Mirrors
// VariantRow.tsx's fetch/confirm/role="alert"/router.refresh() shape.
// Backs specs/admin-console/spec.md "Owner edits a product's core fields",
// "Product slug key in the payload is rejected, not silently ignored",
// "Owner deletes a clean product", "Product delete blocked by order/stock
// history", "Product delete blocked by remaining stock". tasks.md 5.1/5.2.
//
// design.md F7: onHand/held are never editable here — no input exists for
// them, structurally. The uneditable `/producto/{slug}` preview above the
// edit fields shows slug-immutability rather than explaining it (mirrors
// NewCategoryForm's slug preview, E6).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPriceARS } from "@/lib/format-price";
import type { Category, ProductImage, Variant } from "@/generated/prisma/client";
import { AddVariantForm } from "./AddVariantForm";
import { ProductImages } from "./ProductImages";
import { VariantRow } from "./VariantRow";

interface ProductRowProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  categoryId: string;
  category: Category;
  variants: Variant[];
  images: ProductImage[];
}

interface ProductRowProps {
  product: ProductRowProduct;
  categories: { id: string; name: string }[];
}

export function ProductRow({ product, categories }: ProductRowProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.price));
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [description, setDescription] = useState(product.description ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function enterEdit() {
    setName(product.name);
    setPrice(String(product.price));
    setCategoryId(product.categoryId);
    setDescription(product.description ?? "");
    setErrorMessage(null);
    setMode("edit");
  }

  function cancelEdit() {
    setName(product.name);
    setPrice(String(product.price));
    setCategoryId(product.categoryId);
    setDescription(product.description ?? "");
    setErrorMessage(null);
    setMode("view");
  }

  async function handleSave() {
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/admin/products/${product.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description: description === "" ? null : description,
          price: Number(price),
          categoryId,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setErrorMessage(body.message ?? "No pudimos guardar el producto.");
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
      `¿Eliminar el producto "${product.name}"? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) {
      return;
    }

    setErrorMessage(null);

    try {
      const response = await fetch(`/api/admin/products/${product.id}`, { method: "DELETE" });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setErrorMessage(body.message ?? "No pudimos eliminar el producto.");
        return;
      }

      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Error inesperado.");
    }
  }

  function handleFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      cancelEdit();
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleSave();
  }

  const inputClassName = "border border-ink/20 px-3 py-2";

  if (mode === "edit") {
    return (
      <tr className="border-b border-ink/10">
        <td colSpan={6} className="py-4">
          <form
            onSubmit={handleSubmit}
            onKeyDown={handleFormKeyDown}
            className="flex flex-col gap-4"
          >
            <span className="font-sans text-body-sm text-outline">/producto/{product.slug}</span>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
                Nombre
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClassName}
                />
              </label>
              <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
                Precio
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className={inputClassName}
                />
              </label>
              <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
                Categoría
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className={inputClassName}
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
              Descripción
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={inputClassName}
                rows={3}
              />
            </label>

            {errorMessage ? (
              <p role="alert" className="font-sans text-body-md text-red-700">
                {errorMessage}
              </p>
            ) : null}

            <div className="flex gap-4">
              <button
                type="submit"
                disabled={submitting}
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
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="border-b border-ink/10">
        <td className="py-2">{product.name}</td>
        <td className="py-2">{product.category.name}</td>
        <td className="py-2 text-right">{formatPriceARS(product.price)}</td>
        <td className="py-2 text-right">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="font-sans text-body-md text-ink underline-offset-2 hover:underline"
          >
            {product.variants.length}
          </button>
        </td>
        <td className="py-2 text-right">
          {product.images.length === 0 ? (
            <span className="text-red-700">Sin imágenes</span>
          ) : (
            product.images.length
          )}
        </td>
        <td className="py-2 text-right">
          <div className="flex flex-col items-end gap-1">
            <div className="flex justify-end gap-4">
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
            </div>
            {errorMessage ? (
              <p role="alert" className="font-sans text-body-sm text-red-700">
                {errorMessage}
              </p>
            ) : null}
          </div>
        </td>
      </tr>
      {expanded
        ? product.variants.map((variant) => (
            <VariantRow key={variant.id} productId={product.id} variant={variant} />
          ))
        : null}
      {expanded ? <AddVariantForm productId={product.id} /> : null}
      {expanded ? <ProductImages productId={product.id} images={product.images} /> : null}
    </>
  );
}
