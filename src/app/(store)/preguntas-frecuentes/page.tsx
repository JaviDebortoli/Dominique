import type { Metadata } from "next";

// Static FAQ page linked from the storefront footer. Reservation answers
// mirror src/modules/orders/order.service.ts: pickup reservations expire at
// the close of the next open business day; Mercado Pago checkouts hold
// stock for 30 minutes while payment is pending.

export const metadata: Metadata = {
  title: "Preguntas Frecuentes | Dominique",
};

const FAQS = [
  {
    question: "¿Cuánto tiempo se mantiene la reserva de un producto?",
    answer:
      "Si elegís pagar al retirar, tu reserva se mantiene hasta el cierre del siguiente día hábil en que abre el local. Si pagás con Mercado Pago, los productos quedan apartados durante 30 minutos mientras completás el pago.",
  },
  {
    question: "¿Hay un monto mínimo de compra?",
    answer: "No hay mínimo de compra: podés comprar desde un solo producto.",
  },
  {
    question: "¿Cómo recibo mi pedido?",
    answer:
      "Los pedidos se retiran únicamente de manera presencial en nuestro local, en Plata 192, Santiago del Estero. No realizamos envíos.",
  },
] as const;

export default function FaqPage() {
  return (
    <section className="mx-auto max-w-container px-margin-mobile py-section md:px-gutter">
      <h1 className="mb-6 font-serif text-headline-lg-mobile text-ink md:text-headline-lg">
        Preguntas Frecuentes
      </h1>
      <div className="flex max-w-2xl flex-col divide-y divide-ink/20">
        {FAQS.map(({ question, answer }) => (
          <div key={question} className="py-6">
            <h2 className="mb-2 font-serif text-headline-md text-ink">{question}</h2>
            <p className="font-sans text-body-md text-on-surface-variant">{answer}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
