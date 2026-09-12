import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CajaRowActions } from "./CajaRowActions";

// control-de-caja tasks.md 2.7 — "Vender 1" now requires a payment-method
// choice before the sale POST fires (specs/admin-console/spec.md "In-Person
// Sale Payment Method Choice"). Mirrors OrderCancelButton.test.tsx's
// conventions: stubbed global.fetch, mocked next/navigation's useRouter.
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

describe("CajaRowActions", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    refreshMock.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("reveals Efectivo/Transferencia/Cancelar when 'Vender 1' is clicked, without sending a request yet", async () => {
    const user = userEvent.setup();
    render(<CajaRowActions variantId="variant-1" disponible={5} />);

    await user.click(screen.getByRole("button", { name: "Vender 1" }));

    expect(screen.getByRole("button", { name: "Efectivo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transferencia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("blocks the sale POST until a payment method is chosen, then sends paymentMethod in the body", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    render(<CajaRowActions variantId="variant-1" disponible={5} />);
    await user.click(screen.getByRole("button", { name: "Vender 1" }));
    expect(global.fetch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Efectivo" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/stock/sell",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ variantId: "variant-1", qty: 1, paymentMethod: "CASH" }),
      }),
    );
  });

  it("sends paymentMethod: TRANSFER when Transferencia is chosen", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    render(<CajaRowActions variantId="variant-1" disponible={5} />);
    await user.click(screen.getByRole("button", { name: "Vender 1" }));
    await user.click(screen.getByRole("button", { name: "Transferencia" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/stock/sell",
      expect.objectContaining({
        body: JSON.stringify({ variantId: "variant-1", qty: 1, paymentMethod: "TRANSFER" }),
      }),
    );
  });

  it("Cancelar collapses the choice group without sending a request", async () => {
    const user = userEvent.setup();
    render(<CajaRowActions variantId="variant-1" disponible={5} />);

    await user.click(screen.getByRole("button", { name: "Vender 1" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("button", { name: "Efectivo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vender 1" })).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
