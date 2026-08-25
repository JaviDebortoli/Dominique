import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CartLineControls } from "./CartLineControls";

// Backs specs/cart-checkout/spec.md:
//   - "Cart Quantity Editing" (qty control capped at available stock, never
//     below 1; "Quantity cannot reach zero via the stepper" scenario)
//   - "Explicit Line Removal" ("Eliminar" action, not "Quitar", per the
//     proposal's literal scenario copy)
// design.md's CartLineControls interface: bound Server Actions per line
// (`.bind(null, line.variantId)`), mirrors SizeSelector.test.tsx's RTL +
// user-event conventions.
describe("CartLineControls", () => {
  it("disables the − button at qty 1 so the stepper can never remove the line implicitly", async () => {
    const onUpdateQty = vi.fn().mockResolvedValue(undefined);
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(
      <CartLineControls
        qty={1}
        max={5}
        label="Vestido Lino — Talle M"
        onUpdateQty={onUpdateQty}
        onRemove={onRemove}
      />,
    );

    const decrement = screen.getByRole("button", { name: /restar/i });
    expect(decrement).toBeDisabled();

    const user = userEvent.setup();
    await user.click(decrement);
    expect(onUpdateQty).not.toHaveBeenCalled();
  });

  it("enables the − button above qty 1 and calls onUpdateQty with qty - 1", async () => {
    const onUpdateQty = vi.fn().mockResolvedValue(undefined);
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(
      <CartLineControls
        qty={2}
        max={5}
        label="Vestido Lino — Talle M"
        onUpdateQty={onUpdateQty}
        onRemove={onRemove}
      />,
    );

    const decrement = screen.getByRole("button", { name: /restar/i });
    expect(decrement).toBeEnabled();

    const user = userEvent.setup();
    await user.click(decrement);
    expect(onUpdateQty).toHaveBeenCalledWith(1);
  });

  it("disables the + button at the max selectable quantity", async () => {
    const onUpdateQty = vi.fn().mockResolvedValue(undefined);
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(
      <CartLineControls
        qty={3}
        max={3}
        label="Vestido Lino — Talle M"
        onUpdateQty={onUpdateQty}
        onRemove={onRemove}
      />,
    );

    const increment = screen.getByRole("button", { name: /sumar/i });
    expect(increment).toBeDisabled();

    const user = userEvent.setup();
    await user.click(increment);
    expect(onUpdateQty).not.toHaveBeenCalled();
  });

  it("enables the + button below max and calls onUpdateQty with qty + 1", async () => {
    const onUpdateQty = vi.fn().mockResolvedValue(undefined);
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(
      <CartLineControls
        qty={2}
        max={5}
        label="Vestido Lino — Talle M"
        onUpdateQty={onUpdateQty}
        onRemove={onRemove}
      />,
    );

    const increment = screen.getByRole("button", { name: /sumar/i });
    expect(increment).toBeEnabled();

    const user = userEvent.setup();
    await user.click(increment);
    expect(onUpdateQty).toHaveBeenCalledWith(3);
  });

  it("calls onRemove when the explicit Eliminar action is clicked, regardless of quantity", async () => {
    const onUpdateQty = vi.fn().mockResolvedValue(undefined);
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(
      <CartLineControls
        qty={1}
        max={5}
        label="Vestido Lino — Talle M"
        onUpdateQty={onUpdateQty}
        onRemove={onRemove}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("disables the + button when max is 0 (out-of-stock line) without disabling Eliminar", async () => {
    const onUpdateQty = vi.fn().mockResolvedValue(undefined);
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(
      <CartLineControls
        qty={1}
        max={0}
        label="Vestido Lino — Talle M"
        onUpdateQty={onUpdateQty}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByRole("button", { name: /sumar/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeEnabled();
  });
});
