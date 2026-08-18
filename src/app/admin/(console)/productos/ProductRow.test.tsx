import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductRow } from "./ProductRow";

// Mirrors VariantRow.test.tsx's conventions: @testing-library/react +
// user-event, stubbed global.fetch, stubbed window.confirm, mocked
// next/navigation's useRouter. Backs specs/admin-console/spec.md "Owner
// edits a product's core fields", "Product slug key in the payload is
// rejected, not silently ignored", "Owner deletes a clean product",
// "Product delete blocked by order/stock history", "Product delete blocked
// by remaining stock". design.md F9 (ProductRow owns the <tr>, Variantes
// count is the disclosure control revealing VariantRow sub-rows, edit
// replaces the row with a <td colSpan={6}> form row). tasks.md 5.1/5.2.
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const category1 = {
  id: "cat-1",
  name: "Vestidos",
  slug: "vestidos",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const variant1 = {
  id: "var-1",
  productId: "prod-1",
  sku: "VL-BEI-M",
  size: "M",
  color: "Beige",
  priceOverride: null,
  onHand: 5,
  held: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const variant2 = {
  id: "var-2",
  productId: "prod-1",
  sku: "VL-BEI-L",
  size: "L",
  color: "Beige",
  priceOverride: null,
  onHand: 0,
  held: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const product = {
  id: "prod-1",
  name: "Vestido Lino",
  slug: "vestido-lino",
  description: "Vestido de lino premium",
  price: 45000,
  categoryId: "cat-1",
  category: category1,
  variants: [variant1, variant2],
  images: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const categories = [
  { id: "cat-1", name: "Vestidos" },
  { id: "cat-2", name: "Accesorios" },
];

function renderRow(productOverrides: Partial<typeof product> = {}) {
  return render(
    <table>
      <tbody>
        <ProductRow product={{ ...product, ...productOverrides }} categories={categories} />
      </tbody>
    </table>,
  );
}

describe("ProductRow", () => {
  const originalFetch = global.fetch;
  const originalConfirm = window.confirm;

  beforeEach(() => {
    global.fetch = vi.fn();
    window.confirm = vi.fn();
    refreshMock.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.confirm = originalConfirm;
  });

  it("Editar swaps the row for a full-width form seeded with current values, showing /producto/{slug} uneditable", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByLabelText(/nombre/i)).toHaveValue("Vestido Lino");
    expect(screen.getByLabelText(/precio/i)).toHaveValue(45000);
    expect(screen.getByLabelText(/categoría/i)).toHaveValue("cat-1");
    expect(screen.getByLabelText(/descripción/i)).toHaveValue("Vestido de lino premium");
    expect(screen.getByText("/producto/vestido-lino")).toBeInTheDocument();
  });

  it("Escape restores the view without calling fetch", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.clear(screen.getByLabelText(/nombre/i));
    await user.type(screen.getByLabelText(/nombre/i), "Otro nombre");
    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText(/nombre/i)).not.toBeInTheDocument();
    expect(screen.getByText("Vestido Lino")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Cancelar restores the view without calling fetch", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.clear(screen.getByLabelText(/nombre/i));
    await user.type(screen.getByLabelText(/nombre/i), "Otro nombre");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByLabelText(/nombre/i)).not.toBeInTheDocument();
    expect(screen.getByText("Vestido Lino")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Guardar PATCHes the product route with exactly the writable keys and never a slug key", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "prod-1",
        name: "Vestido Lino Beige",
        slug: "vestido-lino",
        description: "Vestido de lino premium",
        price: 48000,
        categoryId: "cat-1",
      }),
    });

    renderRow();
    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.clear(screen.getByLabelText(/nombre/i));
    await user.type(screen.getByLabelText(/nombre/i), "Vestido Lino Beige");
    await user.clear(screen.getByLabelText(/precio/i));
    await user.type(screen.getByLabelText(/precio/i), "48000");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/products/prod-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    const [, requestInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsedBody = JSON.parse(requestInit.body as string);
    expect(parsedBody).toEqual({
      name: "Vestido Lino Beige",
      description: "Vestido de lino premium",
      price: 48000,
      categoryId: "cat-1",
    });
    expect(parsedBody).not.toHaveProperty("slug");
  });

  it("renders a stubbed non-2xx PATCH response's message in role=alert and does not call router.refresh()", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "invalid_category",
        message: "La categoría seleccionada ya no existe. Recargá la página e intentá de nuevo.",
      }),
    });

    renderRow();
    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La categoría seleccionada ya no existe. Recargá la página e intentá de nuevo.",
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("the Variantes count cell toggles rendering of VariantRow sub-rows, collapsed by default", async () => {
    const user = userEvent.setup();
    renderRow();

    expect(screen.queryByText("VL-BEI-M")).not.toBeInTheDocument();
    expect(screen.queryByText("VL-BEI-L")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2" }));

    expect(screen.getByText("VL-BEI-M")).toBeInTheDocument();
    expect(screen.getByText("VL-BEI-L")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2" }));

    expect(screen.queryByText("VL-BEI-M")).not.toBeInTheDocument();
    expect(screen.queryByText("VL-BEI-L")).not.toBeInTheDocument();
  });

  it("sends no DELETE request when confirm() returns false", async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);

    renderRow();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(window.confirm).toHaveBeenCalledWith(
      '¿Eliminar el producto "Vestido Lino"? Esta acción no se puede deshacer.',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends DELETE and calls router.refresh() when confirm() returns true", async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "prod-1" }),
    });

    renderRow();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/products/prod-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("renders a stubbed non-2xx DELETE stock response's cause-specific message in role=alert, and the delete button stays enabled", async () => {
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "product_has_stock",
        message:
          "No se puede eliminar: todavía hay unidades en stock (VL-BEI-M). Ajustá el stock a 0 desde Caja y volvé a intentar.",
        skus: ["VL-BEI-M"],
      }),
    });

    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se puede eliminar: todavía hay unidades en stock (VL-BEI-M). Ajustá el stock a 0 desde Caja y volvé a intentar.",
    );
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeEnabled();
  });

  it("renders a stubbed non-2xx DELETE history response's message in role=alert, and the delete button stays enabled (no client-side precomputation)", async () => {
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "product_has_history",
        message:
          "No se puede eliminar: tiene 3 venta(s) y 5 movimiento(s) de stock registrados. Editalo en lugar de borrarlo, o dejá de reponerlo.",
        orderItemCount: 3,
        stockMovementCount: 5,
      }),
    });

    const user = userEvent.setup();
    renderRow();

    expect(screen.getByRole("button", { name: "Eliminar" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se puede eliminar: tiene 3 venta(s) y 5 movimiento(s) de stock registrados. Editalo en lugar de borrarlo, o dejá de reponerlo.",
    );
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeEnabled();
  });
});
