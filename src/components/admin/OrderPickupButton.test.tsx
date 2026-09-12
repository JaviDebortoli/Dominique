import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderPickupButton } from "./OrderPickupButton";

// control-de-caja tasks.md 4.5/4.6 — "Marcar retirado" now prompts for a
// payment method only for PICKUP_CASH orders (requiresPaymentMethod), while
// MP orders keep their one-click behaviour (specs/order-lifecycle/spec.md
// "Staff marks an MP order picked up (unaffected)"). Mirrors
// OrderCancelButton.test.tsx's conventions.
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

describe("OrderPickupButton", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    refreshMock.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts immediately with no prompt when requiresPaymentMethod is false (MP order)", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "order-1", status: "PICKED_UP" }),
    });

    render(<OrderPickupButton orderId="order-1" requiresPaymentMethod={false} />);
    await user.click(screen.getByRole("button", { name: "Marcar retirado" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/orders/order-1/pickup",
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.queryByRole("button", { name: "Efectivo" })).not.toBeInTheDocument();
  });

  it("reveals the payment-method choice instead of posting when requiresPaymentMethod is true", async () => {
    const user = userEvent.setup();
    render(<OrderPickupButton orderId="order-2" requiresPaymentMethod={true} />);

    await user.click(screen.getByRole("button", { name: "Marcar retirado" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Efectivo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transferencia" })).toBeInTheDocument();
  });

  it("sends the chosen payment method in the POST body and calls router.refresh() on success", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "order-2", status: "PICKED_UP" }),
    });

    render(<OrderPickupButton orderId="order-2" requiresPaymentMethod={true} />);
    await user.click(screen.getByRole("button", { name: "Marcar retirado" }));
    await user.click(screen.getByRole("button", { name: "Transferencia" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/orders/order-2/pickup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ paymentMethod: "TRANSFER" }),
      }),
    );
  });
});
