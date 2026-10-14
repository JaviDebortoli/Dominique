import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Footer } from "./Footer";

describe("Footer", () => {
  it("does not render the newsletter subscription form", () => {
    render(<Footer />);

    expect(screen.queryByText("Suscribite")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("TU EMAIL")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suscribirse" })).not.toBeInTheDocument();
  });

  it("links Preguntas Frecuentes to the FAQ page", () => {
    render(<Footer />);

    expect(screen.getByRole("link", { name: "Preguntas Frecuentes" })).toHaveAttribute(
      "href",
      "/preguntas-frecuentes",
    );
  });

  it("keeps the store info and the other links", () => {
    render(<Footer />);

    expect(screen.getByText(/Plata 192, Santiago del Estero\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contacto" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Instagram" })).toBeInTheDocument();
  });
});
