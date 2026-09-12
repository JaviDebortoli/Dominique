import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoidSaleButton } from "./VoidSaleButton";

// control-de-caja tasks.md 3.8/3.9 — staff "Anular" action for a recorded
// Sale. Backs specs/admin-console/spec.md "Sale Void Action Visibility".
// Mirrors OrderCancelButton.test.tsx's conventions: stubbed global.fetch,
// mocked next/navigation's useRouter.
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

describe("VoidSaleButton", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    refreshMock.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders 'Anular' when the sale has not been voided", () => {
    render(<VoidSaleButton saleId="sale-1" voidedAt={null} />);

    expect(screen.getByRole("button", { name: "Anular" })).toBeInTheDocument();
  });

  it("renders nothing when the sale is already voided", () => {
    render(<VoidSaleButton saleId="sale-1" voidedAt={new Date()} />);

    expect(screen.queryByRole("button", { name: "Anular" })).not.toBeInTheDocument();
  });

  it("reveals an inline confirm before sending the void POST", async () => {
    const user = userEvent.setup();
    render(<VoidSaleButton saleId="sale-1" voidedAt={null} />);

    await user.click(screen.getByRole("button", { name: "Anular" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /confirmar/i })).toBeInTheDocument();
  });

  it("POSTs to the void route and hides the action after a 200 response", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "sale-1", voidedAt: new Date().toISOString() }),
    });

    render(<VoidSaleButton saleId="sale-1" voidedAt={null} />);
    await user.click(screen.getByRole("button", { name: "Anular" }));
    await user.click(screen.getByRole("button", { name: /confirmar/i }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/sales/sale-1/void",
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.queryByRole("button", { name: "Anular" })).not.toBeInTheDocument();
  });

  it("renders a stubbed non-ok response's message in role=alert and keeps the action visible", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "already_voided", message: "Esta venta ya fue anulada." }),
    });

    render(<VoidSaleButton saleId="sale-1" voidedAt={null} />);
    await user.click(screen.getByRole("button", { name: "Anular" }));
    await user.click(screen.getByRole("button", { name: /confirmar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Esta venta ya fue anulada.");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
