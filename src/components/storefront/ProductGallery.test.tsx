import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductGallery } from "./ProductGallery";

// Backs specs/storefront-browsing/spec.md "Product Detail Page Image
// Gallery": image 0 (admin-ordered) is the cover; a thumbnail strip appears
// only with 2+ images; clicking a thumbnail swaps the large image.
describe("ProductGallery", () => {
  const img = (n: number, withAlt = false) => ({
    url: `/uploads/p-${n}.jpg`,
    altText: withAlt ? `Foto ${n}` : null,
  });

  it("shows the cover image large and no thumbnail strip for a single image", () => {
    render(<ProductGallery images={[img(1, true)]} productName="Vestido Roma" />);

    expect(screen.getByRole("img")).toHaveAttribute("src", "/uploads/p-1.jpg");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders one thumbnail per image and swaps the large image when a thumbnail is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ProductGallery
        images={[img(1, true), img(2, true), img(3, true)]}
        productName="Vestido Roma"
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(3);
    // getByRole("img") returns only the large image — thumbnails have alt="".
    expect(screen.getByRole("img")).toHaveAttribute("src", "/uploads/p-1.jpg");

    await user.click(screen.getByRole("button", { name: "Ver imagen 3 de 3" }));

    expect(screen.getByRole("img")).toHaveAttribute("src", "/uploads/p-3.jpg");
  });

  it("falls back to the product name for the large image alt when the cover has none", () => {
    render(<ProductGallery images={[img(2)]} productName="Vestido Roma" />);

    expect(screen.getByRole("img")).toHaveAttribute("alt", "Vestido Roma");
  });

  it("renders a neutral placeholder and no image when the product has none", () => {
    const { container } = render(<ProductGallery images={[]} productName="Vestido Roma" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});
