"use client";

// tasks.md 7.9 — staff "Marcar retirado" action. Calls the already-tested
// POST /api/admin/orders/[orderId]/pickup route (thin wiring over
// order.service.ts's markPickedUp(), design.md D1). The resulting status
// change is immediately visible to the customer via /pedido/[code] (Phase
// 6) — same DB row, no separate cache to invalidate.
//
// control-de-caja design.md D6/tasks.md 4.5-4.6: PICKUP_CASH orders are the
// actual payment-commit moment for that method, so `requiresPaymentMethod`
// (passed by pedidos/page.tsx as `order.method === "PICKUP_CASH"`) reveals
// the same PaymentMethodChoice CajaRowActions uses instead of posting
// immediately. MP orders (`requiresPaymentMethod={false}`) keep their
// original one-click behaviour untouched — payment already happened at the
// webhook (specs/order-lifecycle/spec.md "Staff marks an MP order picked up
// (unaffected)").
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethodChoice, type PaymentMethod } from "./PaymentMethodChoice";

export function OrderPickupButton({
  orderId,
  requiresPaymentMethod = false,
}: {
  orderId: string;
  requiresPaymentMethod?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosingPayment, setChoosingPayment] = useState(false);

  async function markPickedUp(paymentMethod?: PaymentMethod) {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/pickup`, {
        method: "POST",
        ...(paymentMethod
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ paymentMethod }),
            }
          : {}),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? "No se pudo marcar como retirado.");
        return;
      }
      setChoosingPayment(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  function handleClick() {
    if (requiresPaymentMethod) {
      setChoosingPayment(true);
      return;
    }
    void markPickedUp();
  }

  if (choosingPayment) {
    return (
      <div className="flex flex-col items-end gap-1">
        <PaymentMethodChoice
          label="¿Cómo pagó?"
          pending={pending}
          onChoose={markPickedUp}
          onCancel={() => setChoosingPayment(false)}
        />
        {error ? (
          <p role="alert" className="font-sans text-label-caps text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
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
