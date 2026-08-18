import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VariantRow } from "./VariantRow";

// Mirrors CategoryRow.test.tsx's conventions: @testing-library/react +
// user-event, stubbed global.fetch, stubbed window.confirm, mocked
// next/navigation's useRouter. Backs specs/admin-console/spec.md "Owner
// edits a variant's SKU", "Duplicate SKU rejected on variant edit",
// "Variant size/color immutable after first sale", "Owner deletes a clean
// variant", "Variant delete blocked by order/stock history", "Variant
// delete blocked by remaining stock", "Variant delete blocked as the
// product's last remaining variant". design.md F7 (onHand/held never
// editable), F9 (VariantRow is a leaf sub-row, no top border, text-outline
// SKU — reads as an annotation of the product row). tasks.md 4.1/4.2.
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const variant = {
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

function renderRow() {
  return render(
    <table>
      <tbody>
        <VariantRow productId="prod-1" variant={variant} />
      </tbody>
    </table>,
  );
}

describe("VariantRow", () => {
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

  it("swaps sku/size/color cells to inputs seeded with current values when Editar is clicked", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByLabelText(/sku/i)).toHaveValue("VL-BEI-M");
    expect(screen.getByLabelText(/talle/i)).toHaveValue("M");
    expect(screen.getByLabelText(/color/i)).toHaveValue("Beige");
  });

  it("Escape restores the view without calling fetch", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText(/sku/i)).not.toBeInTheDocument();
    expect(screen.getByText("VL-BEI-M")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Cancelar restores the view without calling fetch", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.clear(screen.getByLabelText(/sku/i));
    await user.type(screen.getByLabelText(/sku/i), "OTRO-SKU");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByLabelText(/sku/i)).not.toBeInTheDocument();
    expect(screen.getByText("VL-BEI-M")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Guardar PATCHes the variant route with only changed writable keys and never onHand/held", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "var-1", sku: "VL-BEI-XL", size: "M", color: "Beige" }),
    });

    renderRow();
    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.clear(screen.getByLabelText(/sku/i));
    await user.type(screen.getByLabelText(/sku/i), "VL-BEI-XL");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/products/prod-1/variants/var-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    const [, requestInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsedBody = JSON.parse(requestInit.body as string);
    expect(parsedBody).toEqual({ sku: "VL-BEI-XL", size: "M", color: "Beige" });
    expect(parsedBody).not.toHaveProperty("onHand");
    expect(parsedBody).not.toHaveProperty("held");
  });

  it("renders a stubbed non-2xx PATCH response's message in role=alert and does not call router.refresh()", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "duplicate_sku",
        message: 'Ya existe una variante con el SKU "VL-BEI-XL".',
      }),
    });

    renderRow();
    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.clear(screen.getByLabelText(/sku/i));
    await user.type(screen.getByLabelText(/sku/i), "VL-BEI-XL");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Ya existe una variante con el SKU "VL-BEI-XL".',
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("sends no DELETE request when confirm() returns false", async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);

    renderRow();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(window.confirm).toHaveBeenCalledWith(
      '¿Eliminar la variante "VL-BEI-M"? Esta acción no se puede deshacer.',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends DELETE and calls router.refresh() when confirm() returns true", async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "var-1" }),
    });

    renderRow();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/products/prod-1/variants/var-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("renders a stubbed non-2xx DELETE stock response's cause-specific message in role=alert, and the delete button stays enabled", async () => {
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "variant_has_stock",
        message:
          "No se puede eliminar: todavía hay unidades en stock (VL-BEI-M). Ajustá el stock a 0 desde Caja y volvé a intentar.",
        onHand: 5,
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

  it("renders a stubbed non-2xx DELETE last-variant response's message in role=alert", async () => {
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "last_variant",
        message:
          "No se puede eliminar la última variante. Eliminá el producto entero si ya no lo vendés.",
      }),
    });

    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se puede eliminar la última variante. Eliminá el producto entero si ya no lo vendés.",
    );
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeEnabled();
  });
});
