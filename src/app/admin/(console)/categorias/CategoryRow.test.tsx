import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CategoryRow } from "./CategoryRow";

// Mirrors NewCategoryForm.test.tsx's conventions: @testing-library/react +
// user-event, stubbed global.fetch, mocked next/navigation's useRouter.
// Backs specs/admin-console/spec.md "Owner renames a category", "Slug key
// in the payload is rejected", "Duplicate name rejected on rename", "Owner
// deletes an empty category", "Delete blocked when category has products".
// design.md E6 (inline row edit, no modal). tasks.md 3.1/3.2.
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const category = {
  id: "cat-1",
  name: "Bijou",
  slug: "bijou",
  productCount: 3,
};

function renderRow() {
  return render(
    <table>
      <tbody>
        <CategoryRow category={category} />
      </tbody>
    </table>,
  );
}

describe("CategoryRow", () => {
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

  it("swaps the name cell to a text input seeded with the current name when Editar is clicked", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByRole("textbox")).toHaveValue("Bijou");
  });

  it("Cancelar restores the view without calling fetch", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Otro nombre");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Bijou")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Escape restores the view without calling fetch", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Bijou")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Guardar PATCHes the category with a body containing name and never a slug key", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "cat-1", name: "Bijutería", slug: "bijou" }),
    });

    renderRow();
    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Bijutería");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/categories/cat-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    const [, requestInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsedBody = JSON.parse(requestInit.body as string);
    expect(parsedBody).toEqual({ name: "Bijutería" });
    expect(parsedBody).not.toHaveProperty("slug");
  });

  it("renders a stubbed non-2xx PATCH response's message in role=alert and does not call router.refresh()", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "duplicate_name",
        message: 'Ya existe una categoría llamada "Vestidos".',
      }),
    });

    renderRow();
    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Vestidos");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Ya existe una categoría llamada "Vestidos".',
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("sends no DELETE request when confirm() returns false", async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);

    renderRow();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(window.confirm).toHaveBeenCalledWith(
      '¿Eliminar "Bijou"? Esta acción no se puede deshacer.',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends DELETE and calls router.refresh() when confirm() returns true", async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "cat-1" }),
    });

    renderRow();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/categories/cat-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("renders a stubbed non-2xx DELETE response's message in role=alert", async () => {
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "category_has_products",
        message:
          "No se puede eliminar: tiene 3 producto(s) asignados. Reasigná esos productos primero.",
        productCount: 3,
      }),
    });

    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se puede eliminar: tiene 3 producto(s) asignados. Reasigná esos productos primero.",
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
