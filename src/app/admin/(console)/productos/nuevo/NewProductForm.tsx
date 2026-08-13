"use client";

// tasks.md 7.3 — owner creates a product with variants, stock, and images
// UNAIDED. This client component owns the dynamic variant-row UI and image
// selection; it never talks to Prisma directly (design.md D1) — it only
// calls the two already-tested thin API routes:
//   1. POST /api/admin/upload (tasks.md 7.4/7.5) — once per selected image,
//      BEFORE the product is created, collecting each returned URL. Image
//      bytes are re-encoded server-side; this form only ever sees the
//      resulting `/uploads/products/...` URL back.
//   2. POST /api/admin/products (tasks.md 7.3) — the actual product/variant/
//      image save, wired to src/modules/catalog/product.service.ts's
//      createProduct().
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Category {
  id: string;
  name: string;
}

interface VariantRow {
  size: string;
  color: string;
  sku: string;
  onHand: string;
}

function emptyVariant(): VariantRow {
  return { size: "", color: "", sku: "", onHand: "0" };
}

export function NewProductForm({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [variants, setVariants] = useState<VariantRow[]>([emptyVariant()]);
  const [images, setImages] = useState<File[]>([]);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function updateVariant(index: number, patch: Partial<VariantRow>) {
    setVariants((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addVariantRow() {
    setVariants((rows) => [...rows, emptyVariant()]);
  }

  function removeVariantRow(index: number) {
    setVariants((rows) => rows.filter((_, i) => i !== index));
  }

  async function uploadImages(): Promise<{ url: string }[]> {
    const uploaded: { url: string }[] = [];
    for (const file of images) {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/admin/upload", { method: "POST", body: form });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? "No pudimos subir una de las imágenes.");
      }
      const body = await response.json();
      uploaded.push({ url: body.url });
    }
    return uploaded;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const uploadedImages = await uploadImages();

      const response = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          slug,
          description: description || undefined,
          price: Number(price),
          categoryId,
          variants: variants.map((row) => ({
            size: row.size,
            color: row.color,
            sku: row.sku,
            onHand: Number(row.onHand) || 0,
          })),
          images: uploadedImages,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setErrorMessage(body.message ?? "No pudimos guardar el producto.");
        setStatus("error");
        return;
      }

      router.push("/admin/productos");
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Error inesperado.");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
          Nombre
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-ink/20 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
          Slug
          <input
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="border border-ink/20 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
          Precio
          <input
            required
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="border border-ink/20 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
          Categoría
          <select
            required
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="border border-ink/20 px-3 py-2"
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
          className="border border-ink/20 px-3 py-2"
          rows={3}
        />
      </label>

      <fieldset className="flex flex-col gap-3 border border-ink/20 p-4">
        <legend className="font-sans text-label-caps uppercase tracking-widest text-ink">
          Variantes (talle / color / SKU / stock)
        </legend>
        {variants.map((row, index) => (
          <div key={index} className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <input
              placeholder="Talle"
              required
              value={row.size}
              onChange={(e) => updateVariant(index, { size: e.target.value })}
              className="border border-ink/20 px-2 py-1"
            />
            <input
              placeholder="Color"
              required
              value={row.color}
              onChange={(e) => updateVariant(index, { color: e.target.value })}
              className="border border-ink/20 px-2 py-1"
            />
            <input
              placeholder="SKU"
              required
              value={row.sku}
              onChange={(e) => updateVariant(index, { sku: e.target.value })}
              className="border border-ink/20 px-2 py-1"
            />
            <input
              placeholder="Stock"
              type="number"
              min={0}
              value={row.onHand}
              onChange={(e) => updateVariant(index, { onHand: e.target.value })}
              className="border border-ink/20 px-2 py-1"
            />
            <button
              type="button"
              onClick={() => removeVariantRow(index)}
              disabled={variants.length === 1}
              className="border border-ink/20 px-2 py-1 text-label-caps uppercase disabled:opacity-40"
            >
              Quitar
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addVariantRow}
          className="w-fit border border-ink/20 px-4 py-2 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface"
        >
          Agregar variante
        </button>
      </fieldset>

      <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
        Imágenes (JPEG, PNG o WEBP)
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => setImages(Array.from(e.target.files ?? []))}
        />
      </label>

      {errorMessage ? (
        <p role="alert" className="font-sans text-body-md text-red-700">
          {errorMessage}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-fit bg-nude px-8 py-3 font-sans text-label-caps uppercase tracking-widest text-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "submitting" ? "Guardando…" : "Guardar producto"}
      </button>
    </form>
  );
}
