"use client";

// Backs specs/cart-checkout/spec.md:
//   - "Cart Quantity Editing" (stepper capped at maxSelectable, never below
//     1 — "Quantity cannot reach zero via the stepper")
//   - "Explicit Line Removal" ("Eliminar" action removes the line regardless
//     of its quantity)
// design.md's CartLineControls contract: a client island bound to two
// Server Actions per line (`.bind(null, line.variantId)`, since arity
// differs per callback — the same reason addOneToCart exists). This
// component owns no cart state itself; it only calls the bound actions and
// lets the Server Action's `refresh()` (design.md D3) drive the re-render.

export interface CartLineControlsProps {
  qty: number;
  /** line.maxSelectable — already clamped to >= 0 by resolveCartLines. */
  max: number;
  /** For aria-labels: "Cantidad de {label}". */
  label: string;
  onUpdateQty: (qty: number) => Promise<void>;
  onRemove: () => Promise<void>;
}

export function CartLineControls({ qty, max, label, onUpdateQty, onRemove }: CartLineControlsProps) {
  const canDecrement = qty > 1;
  const canIncrement = qty < max;

  return (
    <div className="flex flex-col items-start gap-2">
      <div
        role="group"
        aria-label={`Cantidad de ${label}`}
        className="flex items-center gap-2"
      >
        <button
          type="button"
          aria-label={`Restar cantidad de ${label}`}
          disabled={!canDecrement}
          onClick={() => onUpdateQty(qty - 1)}
          className="flex h-8 w-8 items-center justify-center border border-ink font-sans text-body-md text-ink hover:bg-surface-container disabled:cursor-not-allowed disabled:border-outline-variant disabled:text-outline disabled:hover:bg-transparent"
        >
          −
        </button>
        <span className="w-6 text-center font-sans text-body-md tabular-nums text-ink">{qty}</span>
        <button
          type="button"
          aria-label={`Sumar cantidad de ${label}`}
          disabled={!canIncrement}
          onClick={() => onUpdateQty(qty + 1)}
          className="flex h-8 w-8 items-center justify-center border border-ink font-sans text-body-md text-ink hover:bg-surface-container disabled:cursor-not-allowed disabled:border-outline-variant disabled:text-outline disabled:hover:bg-transparent"
        >
          +
        </button>
      </div>
      {!canIncrement && max > 0 ? (
        <p className="font-sans text-[10px] uppercase tracking-widest text-on-surface-variant">
          Llegaste al máximo disponible
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => onRemove()}
        className="font-sans text-label-caps uppercase tracking-widest text-red-700 underline"
      >
        Eliminar
      </button>
    </div>
  );
}
