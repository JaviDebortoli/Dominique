"use client";

// In-store sale ("Vender en local", tasks.md 7.7) and manual stock
// correction (tasks.md 7.8) actions for a single /admin/caja row. Both call
// their thin API routes (src/app/api/admin/stock/{sell,adjust}/route.ts)
// and then router.refresh() so the SAME force-dynamic server read that
// backs the whole caja table (design.md rule 4c) reflects the change —
// no separate client-side cache to invalidate.
//
// control-de-caja design.md D6/tasks.md 2.6-2.8: "Vender 1" is now a toggle
// that reveals PaymentMethodChoice ("¿Cómo pagó?") instead of POSTing
// immediately — staff MUST pick Efectivo/Transferencia before the sale
// request is sent (specs/admin-console/spec.md "In-Person Sale Payment
// Method Choice": "there is no default/pre-selected method").
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethodChoice, type PaymentMethod } from "./PaymentMethodChoice";

export function CajaRowActions({ variantId, disponible }: { variantId: string; disponible: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosingPayment, setChoosingPayment] = useState(false);

  async function sell(paymentMethod: PaymentMethod) {
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/admin/stock/sell", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId, qty: 1, paymentMethod }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? "No se pudo vender.");
        return;
      }
      setChoosingPayment(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function adjust(delta: number) {
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/admin/stock/adjust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId, delta }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? "No se pudo ajustar.");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {choosingPayment ? (
        <PaymentMethodChoice
          label="¿Cómo pagó?"
          pending={pending}
          onChoose={sell}
          onCancel={() => setChoosingPayment(false)}
        />
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setChoosingPayment(true)}
            disabled={pending || disponible <= 0}
            className="border border-ink/20 px-3 py-1 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            Vender 1
          </button>
          <button
            type="button"
            onClick={() => adjust(1)}
            disabled={pending}
            className="border border-ink/20 px-3 py-1 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            +1
          </button>
          <button
            type="button"
            onClick={() => adjust(-1)}
            disabled={pending}
            className="border border-ink/20 px-3 py-1 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            -1
          </button>
        </div>
      )}
      {error ? (
        <p role="alert" className="font-sans text-label-caps text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
