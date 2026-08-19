import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderCancelButton } from "./OrderCancelButton";

// Mirrors ProductRow.test.tsx's conventions: stubbed global.fetch, stubbed
// window.confirm, mocked next/navigation's useRouter. Backs
// specs/order-lifecycle/spec.md's cancel scenarios (proposal
// 2026-08-18-admin-cancelar-pedido).
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

describe("OrderCancelButton", () => {
  const originalFetch = global.fetch;
  const originalConfirm = window.confirm;

  beforeEach(() => {
    global.fetch = vi.fn();
    window.confirm = vi.fn();
    refreshMock.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.confirm = originalConfirm;
  });

  it("sends no POST request when confirm() returns false", async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);

    render(<OrderCancelButton orderId="order-1" publicCode="DOM-0001" />);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(window.confirm).toHaveBeenCalledWith("¿Cancelar el pedido DOM-0001?");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("POSTs to the cancel route and calls router.refresh() when confirm() returns true", async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "order-1", status: "CANCELLED" }),
    });

    render(<OrderCancelButton orderId="order-1" publicCode="DOM-0001" />);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/orders/order-1/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("renders a stubbed non-ok response's message in role=alert and does not call router.refresh()", async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "invalid_transition",
        message: "No se puede cancelar: ya está pagado. Para reembolsar, gestionalo desde MercadoPago.",
      }),
    });

    render(<OrderCancelButton orderId="order-1" publicCode="DOM-0001" />);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se puede cancelar: ya está pagado. Para reembolsar, gestionalo desde MercadoPago.",
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
