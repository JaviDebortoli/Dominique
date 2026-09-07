import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CategoryMenu } from "./CategoryMenu";

// Backs the request to move the category nav (previously a static row below
// the "Dominique" wordmark) into a top-right dropdown. Trigger is collapsed
// by default so category links only enter the accessibility tree once
// opened — every assertion below opens it first via the real click/keyboard
// path rather than reaching into component state.
describe("CategoryMenu", () => {
  const categories = [
    { id: "c1", name: "Vestidos", slug: "vestidos" },
    { id: "c2", name: "Accesorios", slug: "accesorios" },
  ];

  it("starts closed, with the category links out of the accessibility tree", () => {
    render(<CategoryMenu categories={categories} />);

    expect(screen.queryByRole("link", { name: "Vestidos" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Categorías/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("marks the trigger as a disclosure with aria-expanded and no aria-haspopup", async () => {
    const user = userEvent.setup();
    render(<CategoryMenu categories={categories} />);

    const trigger = screen.getByRole("button", { name: /Categorías/ });
    // A disclosure, not a menu: the panel is a <nav> of plain links with no
    // menuitem roles or arrow-key model, so aria-haspopup="true" (which ARIA
    // maps to role="menu") would promise an interaction that does not exist.
    expect(trigger).not.toHaveAttribute("aria-haspopup");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).not.toHaveAttribute("aria-haspopup");
  });

  it("opens the category list on trigger click", async () => {
    const user = userEvent.setup();
    render(<CategoryMenu categories={categories} />);

    await user.click(screen.getByRole("button", { name: /Categorías/ }));

    expect(screen.getByRole("button", { name: /Categorías/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("link", { name: "Vestidos" })).toHaveAttribute(
      "href",
      "/categoria/vestidos",
    );
    expect(screen.getByRole("link", { name: "Accesorios" })).toHaveAttribute(
      "href",
      "/categoria/accesorios",
    );
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<CategoryMenu categories={categories} />);

    await user.click(screen.getByRole("button", { name: /Categorías/ }));
    expect(screen.getByRole("link", { name: "Vestidos" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("link", { name: "Vestidos" })).not.toBeInTheDocument();
  });

  it("closes when clicking outside the menu", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <CategoryMenu categories={categories} />
        <button type="button">Fuera del menú</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: /Categorías/ }));
    expect(screen.getByRole("link", { name: "Vestidos" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fuera del menú" }));

    expect(screen.queryByRole("link", { name: "Vestidos" })).not.toBeInTheDocument();
  });

  it("renders nothing when there are no categories", () => {
    const { container } = render(<CategoryMenu categories={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
