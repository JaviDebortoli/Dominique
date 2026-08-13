import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckoutForm, type CheckoutFormItem } from "./CheckoutForm";

// Backs specs/cart-checkout/spec.md:
//   - "Guest-Only Checkout" (contact data only, no account creation)
//   - "No Shipping/Address Collection" — "Checkout form omits address
//     fields": GIVEN a customer reaches the checkout form WHEN the form
//     renders THEN it SHALL contain contact fields only and MUST NOT
//     contain address or shipping-method fields
// tasks.md 4.4.
describe("CheckoutForm", () => {
  const items: CheckoutFormItem[] = [
    { variantId: "v1", label: "Vestido Roma — Talle M", qty: 1, unitPrice: 45000 },
  ];

  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders only the contact fields (name, phone, email) — no address or shipping fields", () => {
    render(<CheckoutForm items={items} />);

    expect(screen.getByLabelText(/nombre/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tel[eé]fono/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();

    const forbidden = [
      /direcci[oó]n/i,
      /\baddress\b/i,
      /env[ií]o/i,
      /shipping/i,
      /ciudad/i,
      /provincia/i,
      /c[oó]digo postal/i,
      /\bzip\b/i,
    ];
    for (const pattern of forbidden) {
      expect(screen.queryByText(pattern)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(pattern)).not.toBeInTheDocument();
    }
  });

  it("requires the customer to choose a payment method before submitting (Dual Payment Choice)", () => {
    render(<CheckoutForm items={items} />);

    expect(
      screen.getByRole("radio", { name: /pagar con mercadopago/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /reservar y pagar al retirar/i }),
    ).toBeInTheDocument();
  });

  it("submits contact fields + method + the exact variant/qty items to /api/checkout (PICKUP_CASH — no redirect)", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 201,
      redirected: false,
      json: async () => ({ orderId: "order-1", publicCode: "DOM-ABC123" }),
    });

    render(<CheckoutForm items={items} />);

    await user.type(screen.getByLabelText(/nombre/i), "Ana Pérez");
    await user.type(screen.getByLabelText(/tel[eé]fono/i), "3815551234");
    await user.type(screen.getByLabelText(/email/i), "ana@example.com");
    await user.click(screen.getByRole("radio", { name: /reservar y pagar al retirar/i }));
    await user.click(screen.getByRole("button", { name: /confirmar pedido/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/checkout");
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody).toEqual({
      buyerName: "Ana Pérez",
      phone: "3815551234",
      email: "ana@example.com",
      method: "PICKUP_CASH",
      items: [{ variantId: "v1", qty: 1 }],
    });

    expect(await screen.findByText(/DOM-ABC123/)).toBeInTheDocument();
  });

  // tasks.md 5.1 — the server responds 303 to MercadoPago's init_point;
  // fetch's default redirect mode ("follow") silently follows it and
  // exposes the final URL via response.redirected/response.url instead of
  // the browser ever navigating on its own. The client must detect that
  // and navigate itself.
  it("MercadoPago path: navigates the browser to response.url when fetch reports a followed redirect", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      redirected: true,
      url: "https://mercadopago.example.com/checkout/pref-123",
      json: async () => ({}),
    });
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
    });

    render(<CheckoutForm items={items} />);
    await user.type(screen.getByLabelText(/nombre/i), "Ana Pérez");
    await user.type(screen.getByLabelText(/tel[eé]fono/i), "3815551234");
    await user.type(screen.getByLabelText(/email/i), "ana@example.com");
    await user.click(screen.getByRole("radio", { name: /pagar con mercadopago/i }));
    await user.click(screen.getByRole("button", { name: /confirmar pedido/i }));

    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith("https://mercadopago.example.com/checkout/pref-123"),
    );
  });

  it("shows the stock_unavailable error message returned by the API without creating a fake success", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "stock_unavailable",
        variantIds: ["v1"],
        message: "Alguno de los talles seleccionados ya no está disponible.",
      }),
    });

    render(<CheckoutForm items={items} />);
    await user.type(screen.getByLabelText(/nombre/i), "Ana Pérez");
    await user.type(screen.getByLabelText(/tel[eé]fono/i), "3815551234");
    await user.type(screen.getByLabelText(/email/i), "ana@example.com");
    await user.click(screen.getByRole("radio", { name: /pagar con mercadopago/i }));
    await user.click(screen.getByRole("button", { name: /confirmar pedido/i }));

    expect(
      await screen.findByText(/ya no está disponible/i),
    ).toBeInTheDocument();
  });
});
