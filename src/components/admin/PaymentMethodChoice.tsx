"use client";

// control-de-caja design.md D6 — shared presentational payment-method
// choice, consumed by CajaRowActions ("Vender 1") and OrderPickupButton
// ("Marcar retirado" for PICKUP_CASH orders). Inline progressive
// disclosure, not a modal: no chrome, no focus trap, works on mobile
// (design.md D6's rejected alternatives). Each container keeps its own
// fetch/error state and calls onChoose(method) directly — clicks go 1 → 2,
// there is no default/pre-selected method (specs/admin-console/spec.md
// "In-Person Sale Payment Method Choice": "there is no default/pre-selected
// method").
import { useEffect, useRef, type KeyboardEvent } from "react";

export type PaymentMethod = "CASH" | "TRANSFER";

export interface PaymentMethodChoiceProps {
  /** Prompt copy, e.g. "¿Cómo pagó?" — identical wording in both call
   * sites per design.md D6. */
  label: string;
  pending: boolean;
  onChoose: (method: PaymentMethod) => void;
  onCancel: () => void;
}

export function PaymentMethodChoice({
  label,
  pending,
  onChoose,
  onCancel,
}: PaymentMethodChoiceProps) {
  const firstChoiceRef = useRef<HTMLButtonElement>(null);

  // design.md D6: "focus moves to the first choice" when the group reveals.
  useEffect(() => {
    firstChoiceRef.current?.focus();
  }, []);

  // design.md D6: "Escape collapses" — same effect as clicking Cancelar.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      onCancel();
    }
  }

  return (
    <div
      role="group"
      aria-label="Método de pago"
      onKeyDown={handleKeyDown}
      className="flex flex-col items-end gap-2"
    >
      <span className="font-sans text-label-caps text-outline">{label}</span>
      <div className="flex gap-2">
        <button
          ref={firstChoiceRef}
          type="button"
          onClick={() => onChoose("CASH")}
          disabled={pending}
          className="border border-ink/20 px-3 py-1 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          Efectivo
        </button>
        <button
          type="button"
          onClick={() => onChoose("TRANSFER")}
          disabled={pending}
          className="border border-ink/20 px-3 py-1 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          Transferencia
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="font-sans text-label-caps uppercase tracking-widest text-outline hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
