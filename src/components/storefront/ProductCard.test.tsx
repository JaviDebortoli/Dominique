import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductCard } from "./ProductCard";

// Backs the sin-stock-badge feature: catalog cards (home curated section and
// category listing) show a "Sin stock" badge top-right on the thumbnail when
// no variant of the product has available stock. The card stays a link to
// the PDP either way — sold-out products are not hidden or disabled.
describe("ProductCard", () => {
  const baseProduct = {
    slug: "vestido-negro",
    name: "Vestido Negro",
    price: 45000,
    thumbnailUrl: "/uploads/vestido.jpg",
    thumbnailAlt: "Vestido Negro",
  };

  it("shows no 'Sin stock' badge when the product has available stock", () => {
    render(<ProductCard product={{ ...baseProduct, soldOut: false }} />);

    expect(screen.queryByText("Sin stock")).not.toBeInTheDocument();
  });

  it("shows the 'Sin stock' badge when the product is sold out", () => {
    render(<ProductCard product={{ ...baseProduct, soldOut: true }} />);

    expect(screen.getByText("Sin stock")).toBeInTheDocument();
  });

  it("keeps the card linking to the PDP even when sold out", () => {
    render(<ProductCard product={{ ...baseProduct, soldOut: true }} />);

    expect(screen.getByRole("link", { name: new RegExp(baseProduct.name) })).toHaveAttribute(
      "href",
      "/producto/vestido-negro",
    );
  });
});
