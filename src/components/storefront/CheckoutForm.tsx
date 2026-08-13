"use client";

import { useState } from "react";
import { formatPriceARS } from "@/lib/format-price";

// Backs specs/cart-checkout/spec.md:
//   - "Guest-Only Checkout" (contact fields only, no account creation)
//   - "No Shipping/Address Collection" ("Checkout form omits address fields")
//   - "Dual Payment Choice" (MercadoPago vs. cash/transfer reservation)
// tasks.md 4.4/4.5. MercadoPago redirect (init_point) is Phase 5 scope
// (tasks.md 5.1) — on success this form only shows the created order's
// public code, it does not redirect anywhere yet.

export interface CheckoutFormItem {
  variantId: string;
  label: string;
  qty: number;
  unitPrice: number;
}

export interface CheckoutFormProps {
  items: CheckoutFormItem[];
}

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; publicCode: string }
  | { status: "error"; message: string };

export function CheckoutForm({ items }: CheckoutFormProps) {
  const [buyerName, setBuyerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [method, setMethod] = useState<"MP" | "PICKUP_CASH">("MP");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  const total = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "submitting" });

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          buyerName,
          phone,
          email,
          method,
          items: items.map((item) => ({ variantId: item.variantId, qty: item.qty })),
        }),
      });

      // tasks.md 5.1 — for method=MP the server responds with a real HTTP
      // 303 to MercadoPago's init_point. fetch's default "follow" redirect
      // mode silently follows it (no browser navigation happens on its
      // own) and exposes the final URL via response.redirected/
      // response.url — this is the signal to navigate the browser there
      // ourselves, before ever trying to parse a JSON body (MercadoPago's
      // hosted checkout page is HTML, not JSON).
      if (response.redirected) {
        window.location.assign(response.url);
        return;
      }

      const body = await response.json();

      if (!response.ok) {
        setState({
          status: "error",
          message:
            typeof body.message === "string"
              ? body.message
              : "No pudimos confirmar tu pedido. Intentá de nuevo.",
        });
        return;
      }

      setState({ status: "success", publicCode: body.publicCode });
    } catch {
      setState({
        status: "error",
        message: "No pudimos conectar con el servidor. Intentá de nuevo.",
      });
    }
  }

  if (state.status === "success") {
    return (
      <div className="flex flex-col gap-2 border border-ink/10 p-6">
        <p className="font-sans text-body-md text-ink">
          ¡Pedido confirmado! Tu código de referencia es{" "}
          <span className="font-semibold">{state.publicCode}</span>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {items.map((item) => (
          <div key={item.variantId} className="flex justify-between font-sans text-body-md">
            <span>
              {item.label} × {item.qty}
            </span>
            <span>{formatPriceARS(item.unitPrice * item.qty)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-ink/10 pt-2 font-sans text-body-md font-semibold">
          <span>Total</span>
          <span>{formatPriceARS(total)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 font-sans text-body-md">
          Nombre
          <input
            type="text"
            required
            value={buyerName}
            onChange={(event) => setBuyerName(event.target.value)}
            className="border border-ink/20 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 font-sans text-body-md">
          Teléfono
          <input
            type="tel"
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="border border-ink/20 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 font-sans text-body-md">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="border border-ink/20 px-3 py-2"
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-sans text-body-md text-ink">Método de pago</legend>
        <label className="flex items-center gap-2 font-sans text-body-md">
          <input
            type="radio"
            name="method"
            value="MP"
            checked={method === "MP"}
            onChange={() => setMethod("MP")}
          />
          Pagar con MercadoPago
        </label>
        <label className="flex items-center gap-2 font-sans text-body-md">
          <input
            type="radio"
            name="method"
            value="PICKUP_CASH"
            checked={method === "PICKUP_CASH"}
            onChange={() => setMethod("PICKUP_CASH")}
          />
          Reservar y pagar al retirar
        </label>
      </fieldset>

      {state.status === "error" ? (
        <p role="alert" className="font-sans text-body-md text-red-700">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={state.status === "submitting"}
        className="w-full bg-nude px-8 py-3 font-sans text-label-caps uppercase tracking-widest text-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Confirmar pedido
      </button>
    </form>
  );
}
