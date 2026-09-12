"use client";

// control-de-caja tasks.md 3.9 — staff "Anular" action for a recorded Sale.
// Calls the already-tested POST /api/admin/sales/[saleId]/void route (thin
// wiring over sale.service.ts's voidSale(), design.md D1). Inline confirm
// (design.md diagram (b): "Anular → confirm inline"), same progressive-
// disclosure precedent as PaymentMethodChoice (D6) rather than
// window.confirm — Anular has a genuine irreversible consequence (restock +
// permanent exclusion from revenue) worth a deliberate second click, not
// just a same-status re-affirmation like OrderCancelButton's blocked-reason
// confirm. Backs specs/admin-console/spec.md "Sale Void Action Visibility".
import { useState } from "react";
import { useRouter } from "next/navigation";

export function VoidSaleButton({
  saleId,
  voidedAt,
}: {
  saleId: string;
  voidedAt: Date | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [voided, setVoided] = useState(voidedAt !== null);

  async function confirmVoid() {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/admin/sales/${saleId}/void`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? "No se pudo anular la venta.");
        return;
      }
      setConfirming(false);
      setVoided(true);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (voided) {
    return null;
  }

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div role="group" aria-label="Confirmar anulación" className="flex gap-2">
          <span className="font-sans text-label-caps text-outline">¿Anular esta venta?</span>
          <button
            type="button"
            onClick={confirmVoid}
            disabled={pending}
            className="font-sans text-label-caps uppercase tracking-widest text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Confirmar
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="font-sans text-label-caps uppercase tracking-widest text-outline hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancelar
          </button>
        </div>
        {error ? (
          <p role="alert" className="font-sans text-label-caps text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="font-sans text-label-caps uppercase tracking-widest text-red-700"
    >
      Anular
    </button>
  );
}
