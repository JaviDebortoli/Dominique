import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import FaqPage from "./page";

describe("/preguntas-frecuentes", () => {
  it("renders the page heading", () => {
    render(<FaqPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Preguntas Frecuentes" })).toBeInTheDocument();
  });

  it("explains how long a reservation is held", () => {
    render(<FaqPage />);

    expect(
      screen.getByRole("heading", { level: 2, name: "¿Cuánto tiempo se mantiene la reserva de un producto?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/hasta el cierre del siguiente día hábil/)).toBeInTheDocument();
    expect(screen.getByText(/30 minutos/)).toBeInTheDocument();
  });

  it("states there is no minimum purchase", () => {
    render(<FaqPage />);

    expect(screen.getByRole("heading", { level: 2, name: "¿Hay un monto mínimo de compra?" })).toBeInTheDocument();
    expect(screen.getByText(/No hay mínimo de compra/)).toBeInTheDocument();
  });

  it("states orders are picked up in person at the store only", () => {
    render(<FaqPage />);

    expect(screen.getByRole("heading", { level: 2, name: "¿Cómo recibo mi pedido?" })).toBeInTheDocument();
    expect(screen.getByText(/únicamente de manera presencial en nuestro local/)).toBeInTheDocument();
  });
});
