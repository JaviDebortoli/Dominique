import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Header } from "./Header";

// Backs specs/storefront-browsing/spec.md "Header Cart Entry Point":
//   - persistent cart icon linking to /carrito (always present, even empty)
//   - item-count badge reflecting current cart contents, server-derived
//     (cartCount is a plain prop here — no client state)
//   - "Badge reflects cart contents on page load"
//   - "Cart icon links to the cart page"
// design.md Visual Design: hand-drawn 1px-stroke bag SVG, no filled circle
// badge; the numeric count itself renders nothing when the cart is empty
// (the icon/link stays persistent per spec); aria-label always names the
// exact count, including 0, for assistive tech.
describe("Header", () => {
  const categories = [{ id: "c1", name: "Vestidos", slug: "vestidos" }];

  it("keeps the cart icon persistent and hides the numeric count when the cart is empty", () => {
    render(<Header categories={categories} cartCount={0} />);

    const cartLink = screen.getByRole("link", { name: "Carrito, 0 artículos" });
    expect(cartLink).toHaveAttribute("href", "/carrito");
    expect(cartLink).not.toHaveTextContent(/\d/);
  });

  it("shows the item count next to the cart icon when the cart has items", () => {
    render(<Header categories={categories} cartCount={3} />);

    const cartLink = screen.getByRole("link", { name: "Carrito, 3 artículos" });
    expect(cartLink).toHaveAttribute("href", "/carrito");
    expect(cartLink).toHaveTextContent("3");
  });

  it("still renders the category navigation alongside the cart entry point", () => {
    render(<Header categories={categories} cartCount={2} />);

    expect(screen.getByRole("link", { name: "Vestidos" })).toHaveAttribute(
      "href",
      "/categoria/vestidos",
    );
  });
});
