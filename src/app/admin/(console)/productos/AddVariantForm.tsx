"use client";

// Inline add-variant mini-form, mounted by ProductRow.tsx's disclosure
// (design.md G9) as the last line of the expanded variant list. Mirrors
// VariantRow.tsx's shape: own fetch, own submitting flag, own
// role="alert" message, router.refresh() on success. Backs
// specs/admin-console/spec.md "Owner adds a variant to an existing
// product" and "Adding a duplicate size+color variant is rejected".
// tasks.md 2.1/2.2.
//
// SKU auto-derives from the product name + talle + color, mirroring
// NewProductForm.tsx's deriveSku()/skuTouched pattern (adapted here to a
// single variant instead of an array of rows). An optional "Stock inicial"
// field supersedes the original design.md G5 "no stock input here, ever"
// decision: entering a quantity is sent as `onHand` and applied server-side
// as an audited stock adjustment (the same mechanism /admin/caja uses), so
// leaving it empty is still the byte-identical "starts at 0" path.
import { useRouter } from "next/navigation";
import { useState } from "react";

interface AddVariantFormProps {
  productId: string;
  productName: string;
}

/** Uppercased, accent-stripped, alphanumeric-only slice of a value. NFD
 * splits accented letters into base + combining mark; the [^a-zA-Z0-9]
 * strip then drops the marks (and spaces, hyphens, etc.) in one pass.
 * Mirrors NewProductForm.tsx's skuPart(). */
function skuPart(value: string, max: number): string {
  return value
    .normalize("NFD")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, max);
}

/** Default SKU: first word of the product name (≤4) + size (≤3) + color
 * (≤3), e.g. "Vestido Roma" / S / Negro -> "VEST-S-NEG". Empty segments are
 * dropped so a half-filled form still produces something sensible. Mirrors
 * NewProductForm.tsx's deriveSku(). */
function deriveSku(productName: string, size: string, color: string): string {
  const firstWord = productName.trim().split(/\s+/)[0] ?? "";
  return [skuPart(firstWord, 4), skuPart(size, 3), skuPart(color, 3)].filter(Boolean).join("-");
}

export function AddVariantForm({ productId, productName }: AddVariantFormProps) {
  const router = useRouter();
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [sku, setSku] = useState("");
  // The owner typed into the SKU field directly, so stop auto-deriving it.
  // Clearing the field back to empty flips this off and auto-derivation
  // resumes (same rule as NewProductForm.tsx's per-row skuTouched).
  const [skuTouched, setSkuTouched] = useState(false);
  const [onHand, setOnHand] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateSize(nextSize: string) {
    setSize(nextSize);
    if (!skuTouched) {
      setSku(deriveSku(productName, nextSize, color));
    }
  }

  function updateColor(nextColor: string) {
    setColor(nextColor);
    if (!skuTouched) {
      setSku(deriveSku(productName, size, nextColor));
    }
  }

  function updateSku(nextSku: string) {
    setSku(nextSku);
    setSkuTouched(nextSku.trim().length > 0);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setErrorMessage(null);

    const initialStock = Number(onHand) || 0;

    try {
      const response = await fetch(`/api/admin/products/${productId}/variants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          initialStock > 0 ? { size, color, sku, onHand: initialStock } : { size, color, sku },
        ),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setErrorMessage(body.message ?? "No pudimos agregar la variante.");
        setSubmitting(false);
        return;
      }

      setSize("");
      setColor("");
      setSku("");
      setSkuTouched(false);
      setOnHand("");
      setSubmitting(false);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Error inesperado.");
      setSubmitting(false);
    }
  }

  function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleSubmit();
  }

  const inputClassName = "border border-ink/20 px-2 py-1 text-body-sm";

  return (
    <tr className="border-b-0">
      <td className="py-2 pl-6" colSpan={6}>
        <form onSubmit={handleFormSubmit} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-body-sm text-ink">
              Talle
              <input
                value={size}
                onChange={(e) => updateSize(e.target.value)}
                className={inputClassName}
              />
            </label>
            <label className="flex flex-col gap-1 text-body-sm text-ink">
              Color
              <input
                value={color}
                onChange={(e) => updateColor(e.target.value)}
                className={inputClassName}
              />
            </label>
            <label className="flex flex-col gap-1 text-body-sm text-ink">
              SKU
              <input
                value={sku}
                onChange={(e) => updateSku(e.target.value)}
                className={inputClassName}
              />
            </label>
            <label className="flex flex-col gap-1 text-body-sm text-ink">
              Stock inicial
              <input
                type="number"
                min={0}
                step={1}
                value={onHand}
                onChange={(e) => setOnHand(e.target.value)}
                className={inputClassName}
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="font-sans text-label-caps uppercase tracking-widest text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              Agregar
            </button>
          </div>
          <span className="font-sans text-body-sm text-outline">
            El SKU se arma solo con el nombre del producto + talle + color. Dejá "Stock inicial"
            vacío para arrancar en 0, o cargá una cantidad — queda registrada como un ajuste
            auditado, igual que en Caja.
          </span>
          {errorMessage ? (
            <p role="alert" className="font-sans text-body-sm text-red-700">
              {errorMessage}
            </p>
          ) : null}
        </form>
      </td>
    </tr>
  );
}
