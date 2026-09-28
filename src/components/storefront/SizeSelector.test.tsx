import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SizeSelector } from "./SizeSelector";

// Backs specs/storefront-browsing/spec.md:
//   - "Product Detail Page Variant Selector" (enable in-stock, disable
//     zero-stock, size -> color two-step selection with real-time
//     per-variant stock)
//   - "Locale and Copy" ("Sin stock" es-AR label)
//   - "add-to-cart enabled only for selected in-stock variant" (tasks.md 3.4)
//
// "Comprar ahora" (buy-now, odd/tasks/comprar-ahora.md T1) navigates via
// next/navigation's useRouter — mocked here mirroring OrderCancelButton.
// test.tsx's pattern (a `push` spy replacing the real client-side router).
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe("SizeSelector", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  // Single-color-per-size fixtures: odd/tasks/selector-color.md's "single-
  // color products behave as today" — selecting a size auto-selects its
  // only color, so these mirror the pre-color-step flow one-for-one.
  const variants = [
    { id: "v-s", size: "S", color: "Negro", available: 3, isAvailable: true },
    { id: "v-m", size: "M", color: "Negro", available: 0, isAvailable: false },
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
      { id: "v-s", size: "S", color: "Negro", available: 3, isAvailable: true },
      { id: "v-l", size: "L", color: "Negro", available: 1, isAvailable: true },
    ];
    render(<SizeSelector variants={threeVariants} onAddToCart={onAddToCart} />);

    await user.click(screen.getByRole("button", { name: "S" }));
    await user.click(screen.getByRole("button", { name: "L" }));
    await user.click(screen.getByRole("button", { name: /agregar al carrito/i }));

    expect(onAddToCart).toHaveBeenCalledWith("v-l");
  });

  // DA-1 (design.md, confirmed by owner): no quantity input on the PDP.
  // "Agregar al carrito" always adds exactly 1 unit; the cap against
  // available stock is enforced as a disable-with-named-reason once the
  // shopper already holds `available` units of that variant in the cart.
  it("disables add to cart with the named at-cap reason when inCartQty already reaches available stock", async () => {
    const user = userEvent.setup();
    render(<SizeSelector variants={variants} inCartQty={{ "v-s": 3 }} />);

    await user.click(screen.getByRole("button", { name: "S" }));

    const addToCart = screen.getByRole("button", {
      name: "Ya tenés el máximo disponible",
    });
    expect(addToCart).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^agregar al carrito$/i })).not.toBeInTheDocument();
  });

  it("keeps the normal enabled label when inCartQty is below available stock", async () => {
    const user = userEvent.setup();
    const onAddToCart = vi.fn();
    render(<SizeSelector variants={variants} inCartQty={{ "v-s": 1 }} onAddToCart={onAddToCart} />);

    await user.click(screen.getByRole("button", { name: "S" }));

    const addToCart = screen.getByRole("button", { name: /^agregar al carrito$/i });
    expect(addToCart).toBeEnabled();

    await user.click(addToCart);
    expect(onAddToCart).toHaveBeenCalledWith("v-s");
  });

  it("treats a variant absent from inCartQty as zero units already in the cart", async () => {
    const user = userEvent.setup();
    render(<SizeSelector variants={variants} inCartQty={{}} />);

    await user.click(screen.getByRole("button", { name: "S" }));

    expect(screen.getByRole("button", { name: /^agregar al carrito$/i })).toBeEnabled();
  });

  // odd/tasks/selector-color.md T1 — size -> color two-step selection.
  describe("size + color two-step selection", () => {
    const sizeColorVariants = [
      { id: "v-m-negro", size: "M", color: "Negro", available: 4, isAvailable: true },
      { id: "v-m-blanco", size: "M", color: "Blanco", available: 0, isAvailable: false },
      { id: "v-l-rojo", size: "L", color: "Rojo", available: 2, isAvailable: true },
      { id: "v-l-azul", size: "L", color: "Azul", available: 1, isAvailable: true },
    ];

    it("shows one Talle button per distinct size, not one per variant", () => {
      render(<SizeSelector variants={sizeColorVariants} />);

      expect(screen.getAllByRole("button", { name: "M" })).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "L" })).toHaveLength(1);
    });

    it("shows a Color group with one button per color of the selected size (multi-color size)", async () => {
      const user = userEvent.setup();
      render(<SizeSelector variants={sizeColorVariants} />);

      expect(screen.queryByRole("group", { name: "Color" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "M" }));

      const colorGroup = screen.getByRole("group", { name: "Color" });
      expect(colorGroup).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Negro" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Blanco" })).toBeInTheDocument();
    });

    it("disables a sold-out color and labels it Sin stock, without enabling purchase buttons", async () => {
      const user = userEvent.setup();
      render(<SizeSelector variants={sizeColorVariants} />);

      await user.click(screen.getByRole("button", { name: "M" }));

      const blanco = screen.getByRole("button", { name: "Blanco" });
      expect(blanco).toBeDisabled();
      expect(screen.getByText("Sin stock")).toBeInTheDocument();

      await user.click(blanco);

      expect(screen.getByRole("button", { name: /agregar al carrito/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /comprar ahora/i })).toBeDisabled();
    });

    it("enables purchase buttons and acts on the selected size+color variant once an available color is chosen", async () => {
      const user = userEvent.setup();
      const onAddToCart = vi.fn();
      render(<SizeSelector variants={sizeColorVariants} onAddToCart={onAddToCart} />);

      await user.click(screen.getByRole("button", { name: "M" }));
      const negro = screen.getByRole("button", { name: "Negro" });
      expect(negro).toBeEnabled();
      await user.click(negro);
      expect(negro).toHaveAttribute("aria-pressed", "true");

      const addToCart = screen.getByRole("button", { name: /agregar al carrito/i });
      expect(addToCart).toBeEnabled();
      await user.click(addToCart);
      expect(onAddToCart).toHaveBeenCalledWith("v-m-negro");

      await user.click(screen.getByRole("button", { name: /comprar ahora/i }));
      expect(pushMock).toHaveBeenCalledWith("/checkout?variante=v-m-negro");
    });

    it("changing size resets the color selection when the new size has more than one color", async () => {
      const user = userEvent.setup();
      render(<SizeSelector variants={sizeColorVariants} />);

      await user.click(screen.getByRole("button", { name: "M" }));
      await user.click(screen.getByRole("button", { name: "Negro" }));
      expect(screen.getByRole("button", { name: /agregar al carrito/i })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "L" }));

      expect(screen.getByRole("button", { name: /agregar al carrito/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /comprar ahora/i })).toBeDisabled();
    });

    it("auto-selects the only color when a size has exactly one color, enabling purchase buttons immediately", async () => {
      const user = userEvent.setup();
      const onAddToCart = vi.fn();
      const singleColorForSize = [
        ...sizeColorVariants,
        { id: "v-s-verde", size: "S", color: "Verde", available: 5, isAvailable: true },
      ];
      render(<SizeSelector variants={singleColorForSize} onAddToCart={onAddToCart} />);

      await user.click(screen.getByRole("button", { name: "S" }));

      expect(screen.getByRole("button", { name: "Verde" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: /agregar al carrito/i })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: /agregar al carrito/i }));
      expect(onAddToCart).toHaveBeenCalledWith("v-s-verde");
    });

    it("disables a multi-color size and labels it Sin stock when every one of its colors is sold out", async () => {
      const user = userEvent.setup();
      const allColorsSoldOutForSize = [
        ...sizeColorVariants,
        { id: "v-xl-negro", size: "XL", color: "Negro", available: 0, isAvailable: false },
        { id: "v-xl-blanco", size: "XL", color: "Blanco", available: 0, isAvailable: false },
      ];
      render(<SizeSelector variants={allColorsSoldOutForSize} />);

      const xl = screen.getByRole("button", { name: "XL" });
      expect(xl).toBeDisabled();
      // Sizes M and L each keep at least one available color, so XL is the
      // only size-level "Sin stock" label before any size is selected.
      expect(screen.getAllByText("Sin stock")).toHaveLength(1);

      await user.click(xl);

      expect(screen.queryByRole("group", { name: "Color" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /agregar al carrito/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /comprar ahora/i })).toBeDisabled();
    });
  });

  // odd/tasks/comprar-ahora.md T1 — "Comprar ahora" buys one unit of the
  // selected variant directly, bypassing the cart entirely.
  describe("Comprar ahora (buy-now)", () => {
    it("keeps comprar ahora disabled until an in-stock size is selected", () => {
      render(<SizeSelector variants={variants} />);

      expect(screen.getByRole("button", { name: /comprar ahora/i })).toBeDisabled();
    });

    it("never enables comprar ahora for the zero-stock size", async () => {
      render(<SizeSelector variants={variants} />);

      await userEvent.setup().click(screen.getByRole("button", { name: "M" }));

      expect(screen.getByRole("button", { name: /comprar ahora/i })).toBeDisabled();
    });

    it("enables comprar ahora for a selected in-stock variant even when inCartQty already reaches the cap (ignores the cart)", async () => {
      const user = userEvent.setup();
      render(<SizeSelector variants={variants} inCartQty={{ "v-s": 3 }} />);

      await user.click(screen.getByRole("button", { name: "S" }));

      expect(screen.getByRole("button", { name: /comprar ahora/i })).toBeEnabled();
    });

    it("navigates to /checkout?variante=<id> for the selected variant when clicked", async () => {
      const user = userEvent.setup();
      render(<SizeSelector variants={variants} />);

      await user.click(screen.getByRole("button", { name: "S" }));
      await user.click(screen.getByRole("button", { name: /comprar ahora/i }));

      expect(pushMock).toHaveBeenCalledWith("/checkout?variante=v-s");
      expect(pushMock).toHaveBeenCalledTimes(1);
    });

    it("triangulation: switching selection navigates using the newly selected variant's id", async () => {
      const user = userEvent.setup();
      const threeVariants = [
        { id: "v-s", size: "S", color: "Negro", available: 3, isAvailable: true },
        {
          id: "v-l/needs encoding",
          size: "L",
          color: "Negro",
          available: 1,
          isAvailable: true,
        },
      ];
      render(<SizeSelector variants={threeVariants} />);

      await user.click(screen.getByRole("button", { name: "S" }));
      await user.click(screen.getByRole("button", { name: "L" }));
      await user.click(screen.getByRole("button", { name: /comprar ahora/i }));

      expect(pushMock).toHaveBeenCalledWith(
        `/checkout?variante=${encodeURIComponent("v-l/needs encoding")}`,
      );
    });
  });
});
