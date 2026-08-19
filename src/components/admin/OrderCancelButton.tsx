"use client";

// proposal 2026-08-18-admin-cancelar-pedido — staff "Cancelar" action.
// Calls the already-tested POST /api/admin/orders/[orderId]/cancel route
// (thin wiring over order.service.ts's cancelOrder(), design.md D1).
// confirm()-gated per the codebase's destructive-action convention
// (ProductRow.tsx's "Eliminar"); the generic confirm wording does NOT
// mention the stock-release consequence (proposal Refinements). Styled
// borderless/text-red-700 rather than bordered like OrderPickupButton — the
// block reason here is always the same (wrong status), so a bordered
// always-clickable-then-error shape isn't warranted (design.md "Stacked
// action cell" decision).
import { useState } from "react";
import { useRouter } from "next/navigation";

export function OrderCancelButton({
  orderId,
  publicCode,
}: {
  orderId: string;
  publicCode: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancelOrder() {
    const confirmed = window.confirm(`¿Cancelar el pedido ${publicCode}?`);
    if (!confirmed) {
      return;
    }

    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/cancel`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? "No se pudo cancelar el pedido.");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={cancelOrder}
        disabled={pending}
        className="font-sans text-label-caps uppercase tracking-widest text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Cancelar
      </button>
      {error ? (
        <p role="alert" className="font-sans text-label-caps text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
