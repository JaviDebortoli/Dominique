import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({
  authenticate: vi.fn(async () => undefined),
}));

import AdminLoginPage from "./page";

describe("AdminLoginPage password visibility toggle", () => {
  it("hides the password by default", () => {
    render(<AdminLoginPage />);

    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Mostrar contraseña" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows the typed password and hides it again when toggled", async () => {
    const user = userEvent.setup();
    render(<AdminLoginPage />);
    const input = screen.getByLabelText("Contraseña");
    await user.type(input, "secret123");

    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("secret123");
    expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Ocultar contraseña" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("does not submit the form when toggling", () => {
    render(<AdminLoginPage />);

    expect(screen.getByRole("button", { name: "Mostrar contraseña" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("keeps the email field and submit button unchanged", () => {
    render(<AdminLoginPage />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "Ingresar" })).toHaveAttribute("type", "submit");
  });
});
