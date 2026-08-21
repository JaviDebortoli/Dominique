"use client";

// Inline add-variant mini-form, mounted by ProductRow.tsx's disclosure
// (design.md G9) as the last line of the expanded variant list. Mirrors
// VariantRow.tsx's shape: own fetch, own submitting flag, own
// role="alert" message, router.refresh() on success. Backs
// specs/admin-console/spec.md "Owner adds a variant to an existing
// product" and "Adding a duplicate size+color variant is rejected".
// tasks.md 2.1/2.2.
//
// design.md G5/Non-Goal: there is NO stock input here, structurally — a
// new variant always starts at onHand: 0. The note below tells the owner
// where stock actually lives instead of leaving the omission unexplained.
import { useRouter } from "next/navigation";
import { useState } from "react";

interface AddVariantFormProps {
  productId: string;
}

export function AddVariantForm({ productId }: AddVariantFormProps) {
  const router = useRouter();
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [sku, setSku] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/admin/products/${productId}/variants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ size, color, sku }),
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
                onChange={(e) => setSize(e.target.value)}
                className={inputClassName}
              />
            </label>
            <label className="flex flex-col gap-1 text-body-sm text-ink">
              Color
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className={inputClassName}
              />
            </label>
            <label className="flex flex-col gap-1 text-body-sm text-ink">
              SKU
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
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
            Empieza en 0. Cargá stock desde Caja.
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
