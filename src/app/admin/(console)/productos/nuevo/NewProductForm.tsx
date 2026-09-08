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
//
// Layout: product fields on the left, an image panel on the right (it fills
// the space the single-column form used to leave empty). Each picked file
// gets a local preview via URL.createObjectURL — created when the file is
// chosen, revoked when it's removed and on unmount — so the owner sees the
// images before the product is saved.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toSlug } from "@/lib/slugify";

// Mirrors src/modules/catalog/product.service.ts's MAX_PRODUCT_IMAGES — the
// server enforces the real cap on create; this only keeps the picker honest.
const MAX_IMAGES = 5;

interface Category {
  id: string;
  name: string;
}

interface VariantRow {
  size: string;
  color: string;
  /** Only meaningful when `skuTouched` is true — otherwise the SKU is
   * derived from the product name + this row's size/color at render/submit. */
  sku: string;
  /** The owner typed into the SKU field, so stop auto-deriving it. Clearing
   * the field back to empty flips this off and auto-derivation resumes. */
  skuTouched: boolean;
  onHand: string;
}

interface PickedImage {
  file: File;
  previewUrl: string;
}

function emptyVariant(): VariantRow {
  return { size: "", color: "", sku: "", skuTouched: false, onHand: "0" };
}

/** Uppercased, accent-stripped, alphanumeric-only slice of a value. NFD
 * splits accented letters into base + combining mark; the [^a-zA-Z0-9]
 * strip then drops the marks (and spaces, hyphens, etc.) in one pass. */
function skuPart(value: string, max: number): string {
  return value
    .normalize("NFD")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, max);
}

/** Default SKU: first word of the product name (≤4) + size (≤3) + color (≤3),
 * e.g. "Vestido Roma" / S / Negro -> "VEST-S-NEG". Empty segments are
 * dropped so a half-filled row still produces something sensible. */
function deriveSku(productName: string, size: string, color: string): string {
  const firstWord = productName.trim().split(/\s+/)[0] ?? "";
  return [skuPart(firstWord, 4), skuPart(size, 3), skuPart(color, 3)].filter(Boolean).join("-");
}

export function NewProductForm({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Slug auto-follows the name through toSlug() (the SAME pure function the
  // server route validates against) until the owner hand-edits the field.
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [variants, setVariants] = useState<VariantRow[]>([emptyVariant()]);
  const [images, setImages] = useState<PickedImage[]>([]);
  // Bumped after every pick so the same file can be chosen again right after
  // it was removed (a file <input> won't re-fire change for an unchanged value).
  const [fileInputKey, setFileInputKey] = useState(0);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Object URLs are created in the pick handler and revoked in the remove
  // handler; this ref + effect only cover the "owner navigated away with
  // files still staged" case so no blob leaks past unmount.
  const imagesRef = useRef<PickedImage[]>([]);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, []);

  const atImageCap = images.length >= MAX_IMAGES;

  function updateVariant(index: number, patch: Partial<VariantRow>) {
    setVariants((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;
        const merged = { ...row, ...patch };
        // Re-derive the SKU whenever size/color changes on a row the owner
        // hasn't hand-edited (keeping it in sync so `row.sku` is always the
        // live value shown, derived or manual).
        if (!merged.skuTouched && ("size" in patch || "color" in patch)) {
          merged.sku = deriveSku(name, merged.size, merged.color);
        }
        return merged;
      }),
    );
  }

  function updateName(nextName: string) {
    setName(nextName);
    if (!slugTouched) {
      setSlug(toSlug(nextName));
    }
    setVariants((rows) =>
      rows.map((row) =>
        row.skuTouched ? row : { ...row, sku: deriveSku(nextName, row.size, row.color) },
      ),
    );
  }

  function updateSlug(nextSlug: string) {
    setSlugTouched(nextSlug.trim().length > 0);
    setSlug(nextSlug);
  }

  function addVariantRow() {
    setVariants((rows) => [...rows, emptyVariant()]);
  }

  function removeVariantRow(index: number) {
    setVariants((rows) => rows.filter((_, i) => i !== index));
  }

  function addImages(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setImages((current) => {
      const room = MAX_IMAGES - current.length;
      if (room <= 0) return current;
      const picked = Array.from(fileList)
        .slice(0, room)
        .map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
      return [...current, ...picked];
    });
    setFileInputKey((key) => key + 1);
  }

  function removeImage(index: number) {
    setImages((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((_, i) => i !== index);
    });
  }

  async function uploadImages(): Promise<{ url: string }[]> {
    const uploaded: { url: string }[] = [];
    for (const image of images) {
      const form = new FormData();
      form.set("file", image.file);
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
            // `row.sku` is kept in sync by updateVariant/updateName; fall back
            // to a fresh derivation only if a row was never touched at all.
            sku: row.sku || deriveSku(name, row.size, row.color),
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

  const fieldClassName = "border border-ink/20 px-3 py-2";

  return (
    <form
      onSubmit={handleSubmit}
      className="flex max-w-5xl flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-10"
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
            Nombre
            <input
              required
              value={name}
              onChange={(e) => updateName(e.target.value)}
              className={fieldClassName}
            />
          </label>
          <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
            Slug
            <input
              required
              value={slug}
              onChange={(e) => updateSlug(e.target.value)}
              className={fieldClassName}
            />
            <span className="font-sans text-body-sm text-outline">/producto/{slug || "…"}</span>
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
              className={fieldClassName}
            />
          </label>
          <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
            Categoría
            <select
              required
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={fieldClassName}
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
            className={fieldClassName}
            rows={3}
          />
        </label>

        <fieldset className="flex flex-col gap-3 border border-ink/20 p-4">
          <legend className="font-sans text-label-caps uppercase tracking-widest text-ink">
            Variantes (talle / color / SKU / stock)
          </legend>
          <p className="font-sans text-body-sm text-outline">
            El SKU se arma solo con el nombre del producto + talle + color. Editalo si
            necesitás otro.
          </p>
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
                placeholder="SKU (automático)"
                value={row.sku}
                onChange={(e) => {
                  const next = e.target.value;
                  updateVariant(index, { sku: next, skuTouched: next.trim().length > 0 });
                }}
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
      </div>

      <aside className="flex flex-col gap-3 border border-ink/20 p-4">
        <h2 className="font-sans text-label-caps uppercase tracking-widest text-ink">Imágenes</h2>

        {images.length > 0 ? (
          <ul className="flex flex-wrap gap-3">
            {images.map((image, index) => (
              <li key={image.previewUrl} className="flex flex-col items-center gap-1">
                {/* Local blob preview of a not-yet-uploaded file — next/image
                    can't optimize a blob: URL, and this mirrors ProductCard /
                    ProductImages' plain-<img> rule for admin-managed art. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.previewUrl}
                  alt={`Vista previa ${index + 1}`}
                  className="h-20 w-20 border border-ink/10 object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="font-sans text-label-caps uppercase tracking-widest text-red-700"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-sans text-body-sm text-outline">
            Todavía no elegiste imágenes. La primera será la principal.
          </p>
        )}

        {atImageCap ? (
          <span className="font-sans text-body-sm text-outline">Máximo {MAX_IMAGES} imágenes.</span>
        ) : (
          <label className="flex flex-col gap-1 font-sans text-body-sm text-ink">
            Elegir archivos
            <input
              key={fileInputKey}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => addImages(e.target.files)}
              className="font-sans text-body-sm text-ink file:mr-4 file:border file:border-ink/20 file:bg-paper file:px-3 file:py-1 file:font-sans file:text-label-caps file:uppercase file:tracking-widest file:text-ink hover:file:bg-surface"
            />
          </label>
        )}

        <span className="font-sans text-body-sm text-outline">
          JPEG, PNG o WEBP · hasta 5&nbsp;MB cada una.
        </span>
      </aside>
    </form>
  );
}
