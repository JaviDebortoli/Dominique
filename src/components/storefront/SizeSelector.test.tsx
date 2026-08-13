import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SizeSelector } from "./SizeSelector";

// Backs specs/storefront-browsing/spec.md:
//   - "Product Detail Page Variant Selector" (enable in-stock, disable
//     zero-stock)
//   - "Locale and Copy" ("Sin stock" es-AR label)
//   - "add-to-cart enabled only for selected in-stock variant" (tasks.md 3.4)
describe("SizeSelector", () => {
  const variants = [
    { id: "v-s", size: "S", available: 3, isAvailable: true },
    { id: "v-m", size: "M", available: 0, isAvailable: false },
  ];

  it("keeps add to cart disabled until an in-stock size is selected, then enables it", async () => {
    const user = userEvent.setup();
    render(<SizeSelector variants={variants} />);

    const addToCart = screen.getByRole("button", { name: /agregar al carrito/i });
    expect(addToCart).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "S" }));

    expect(addToCart).toBeEnabled();
  });

  it("disables the zero-stock size, labels it Sin stock, and it never enables add to cart", async () => {
    const user = userEvent.setup();
    render(<SizeSelector variants={variants} />);

    const soldOutButton = screen.getByRole("button", { name: "M" });
    expect(soldOutButton).toBeDisabled();
    expect(screen.getByText("Sin stock")).toBeInTheDocument();

    await user.click(soldOutButton);

    expect(screen.getByRole("button", { name: /agregar al carrito/i })).toBeDisabled();
  });

  it("calls onAddToCart with the selected in-stock variant id when clicked", async () => {
    const user = userEvent.setup();
    const onAddToCart = vi.fn();
    render(<SizeSelector variants={variants} onAddToCart={onAddToCart} />);

    await user.click(screen.getByRole("button", { name: "S" }));
    await user.click(screen.getByRole("button", { name: /agregar al carrito/i }));

    expect(onAddToCart).toHaveBeenCalledWith("v-s");
    expect(onAddToCart).toHaveBeenCalledTimes(1);
  });

  it("triangulation: switching selection to a second in-stock size re-enables cart for the new variant", async () => {
    const user = userEvent.setup();
    const onAddToCart = vi.fn();
    const threeVariants = [
      { id: "v-s", size: "S", available: 3, isAvailable: true },
      { id: "v-l", size: "L", available: 1, isAvailable: true },
    ];
    render(<SizeSelector variants={threeVariants} onAddToCart={onAddToCart} />);

    await user.click(screen.getByRole("button", { name: "S" }));
    await user.click(screen.getByRole("button", { name: "L" }));
    await user.click(screen.getByRole("button", { name: /agregar al carrito/i }));

    expect(onAddToCart).toHaveBeenCalledWith("v-l");
  });
});
