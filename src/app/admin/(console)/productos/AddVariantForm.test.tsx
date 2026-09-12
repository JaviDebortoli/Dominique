import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddVariantForm } from "./AddVariantForm";

// Mirrors VariantRow.test.tsx's conventions: @testing-library/react +
// user-event, stubbed global.fetch, mocked next/navigation's useRouter.
// Backs specs/admin-console/spec.md "Owner adds a variant to an existing
// product" and "Adding a duplicate size+color variant is rejected".
// design.md G9 (own full-width <tr> row). tasks.md 2.1/2.2.
//
// SKU auto-derive mirrors NewProductForm.tsx's deriveSku()/skuTouched
// pattern, adapted to this form's single (non-array) variant. An optional
// "Stock inicial" input supersedes the original G5 "no stock input, ever"
// decision — entering a value here is only included in the POST body when
// greater than 0, so the "leave it empty" path stays byte-identical to
// before (no onHand key sent at all).
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

function renderForm(productName = "Vestido Roma") {
  return render(
    <table>
      <tbody>
        <AddVariantForm productId="prod-1" productName={productName} />
      </tbody>
    </table>,
  );
}

describe("AddVariantForm", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    refreshMock.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders Talle/Color/SKU/Stock inicial inputs and an Agregar button", () => {
    renderForm();

    expect(screen.getByLabelText(/talle/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/color/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sku/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/stock inicial/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar" })).toBeInTheDocument();
  });

  it("auto-derives the SKU from the product name + talle + color as they're typed", async () => {
    const user = userEvent.setup();
    renderForm("Vestido Roma");

    await user.type(screen.getByLabelText(/talle/i), "S");
    await user.type(screen.getByLabelText(/color/i), "Negro");

    expect(screen.getByLabelText(/sku/i)).toHaveValue("VEST-S-NEG");
  });

  it("stops auto-deriving the SKU once the owner types into it directly", async () => {
    const user = userEvent.setup();
    renderForm("Vestido Roma");

    await user.type(screen.getByLabelText(/talle/i), "S");
    await user.type(screen.getByLabelText(/color/i), "Negro");
    await user.clear(screen.getByLabelText(/sku/i));
    await user.type(screen.getByLabelText(/sku/i), "CUSTOM-SKU");
    await user.type(screen.getByLabelText(/color/i), "Azul");

    expect(screen.getByLabelText(/sku/i)).toHaveValue("CUSTOM-SKU");
  });

  it("Agregar POSTs { size, color, sku } and omits onHand entirely when Stock inicial is left empty", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "var-new", sku: "VEST-L-BEI", size: "L", color: "Beige" }),
    });

    renderForm("Vestido Roma");
    await user.type(screen.getByLabelText(/talle/i), "L");
    await user.type(screen.getByLabelText(/color/i), "Beige");
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/products/prod-1/variants",
      expect.objectContaining({ method: "POST" }),
    );
    const [, requestInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsedBody = JSON.parse(requestInit.body as string);
    expect(parsedBody).toEqual({ size: "L", color: "Beige", sku: "VEST-L-BEI" });
    expect(parsedBody).not.toHaveProperty("onHand");
    expect(parsedBody).not.toHaveProperty("held");
  });

  it("Agregar includes onHand when Stock inicial is a positive number, and never a held key", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "var-new", sku: "VEST-L-BEI", size: "L", color: "Beige" }),
    });

    renderForm("Vestido Roma");
    await user.type(screen.getByLabelText(/talle/i), "L");
    await user.type(screen.getByLabelText(/color/i), "Beige");
    await user.type(screen.getByLabelText(/stock inicial/i), "5");
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    const [, requestInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsedBody = JSON.parse(requestInit.body as string);
    expect(parsedBody).toEqual({ size: "L", color: "Beige", sku: "VEST-L-BEI", onHand: 5 });
    expect(parsedBody).not.toHaveProperty("held");
  });

  it("renders a stubbed non-2xx response's message in role=alert and does not call router.refresh()", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "duplicate_variant",
        message: 'Ya existe una variante talle "M" color "Negro". Editá la existente.',
      }),
    });

    renderForm();
    await user.type(screen.getByLabelText(/talle/i), "M");
    await user.type(screen.getByLabelText(/color/i), "Negro");
    await user.type(screen.getByLabelText(/sku/i), "VL-NEG-M");
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Ya existe una variante talle "M" color "Negro". Editá la existente.',
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("a 200/201 response clears all four inputs and calls router.refresh()", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "var-new", sku: "VL-BEI-L", size: "L", color: "Beige" }),
    });

    renderForm();
    await user.type(screen.getByLabelText(/talle/i), "L");
    await user.type(screen.getByLabelText(/color/i), "Beige");
    await user.type(screen.getByLabelText(/sku/i), "VL-BEI-L");
    await user.type(screen.getByLabelText(/stock inicial/i), "5");
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    expect(screen.getByLabelText(/talle/i)).toHaveValue("");
    expect(screen.getByLabelText(/color/i)).toHaveValue("");
    expect(screen.getByLabelText(/sku/i)).toHaveValue("");
    expect(screen.getByLabelText(/stock inicial/i)).toHaveValue(null);
  });
});
