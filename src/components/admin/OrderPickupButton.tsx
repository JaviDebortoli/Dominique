"use client";

// tasks.md 7.9 — staff "Marcar retirado" action. Calls the already-tested
// POST /api/admin/orders/[orderId]/pickup route (thin wiring over
// order.service.ts's markPickedUp(), design.md D1). The resulting status
// change is immediately visible to the customer via /pedido/[code] (Phase
// 6) — same DB row, no separate cache to invalidate.
import { useState } from "react";
import { useRouter } from "next/navigation";

export function OrderPickupButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markPickedUp() {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/pickup`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? "No se pudo marcar como retirado.");
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
        onClick={markPickedUp}
        disabled={pending}
        className="border border-ink/20 px-3 py-1 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
      >
        Marcar retirado
      </button>
      {error ? (
        <p role="alert" className="font-sans text-label-caps text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
