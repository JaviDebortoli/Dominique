import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Product } from "@/generated/prisma/client";
import { ProductTableBody } from "./ProductTableBody";

// Backs the request: opening "Editar" on a second product while a first
// one is already open must close the first — at most one edit form open
// at a time, oldest evicted first (FIFO of 1). ProductRow itself is
// exercised in depth by ProductRow.test.tsx; this file only covers the
// cross-row coordination that ProductRow can't see on its own.
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

function buildProduct(id: string, name: string) {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    description: null,
    price: 10000 as unknown as Product["price"],
    categoryId: "cat-1",
    category: {
      id: "cat-1",
      name: "Vestidos",
      slug: "vestidos",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    variants: [],
    images: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const products = [buildProduct("prod-1", "Vestido A"), buildProduct("prod-2", "Vestido B")];
const categories = [{ id: "cat-1", name: "Vestidos" }];

describe("ProductTableBody", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    refreshMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes the previously open row's edit form when a different row's Editar is clicked", async () => {
    const user = userEvent.setup();
    render(
      <table>
        <ProductTableBody products={products} categories={categories} />
      </table>,
    );

    const editButtons = screen.getAllByRole("button", { name: "Editar" });
    await user.click(editButtons[0]);

    expect(screen.getAllByLabelText(/nombre/i)).toHaveLength(1);
    expect(screen.getByLabelText(/nombre/i)).toHaveValue("Vestido A");

    // Editar on the second row is now the ONLY visible "Editar" button —
    // the first row is mid-edit and shows Guardar/Cancelar instead.
    await user.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getAllByLabelText(/nombre/i)).toHaveLength(1);
    expect(screen.getByLabelText(/nombre/i)).toHaveValue("Vestido B");
    expect(screen.getByText("Vestido A")).toBeInTheDocument();
  });

  it("returns the row to view mode and frees every row after a successful save", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "prod-1",
        name: "Vestido A editado",
        slug: "vestido-a",
        description: null,
        price: 10000,
        categoryId: "cat-1",
      }),
    });

    render(
      <table>
        <ProductTableBody products={products} categories={categories} />
      </table>,
    );

    await user.click(screen.getAllByRole("button", { name: "Editar" })[0]);
    await user.clear(screen.getByLabelText(/nombre/i));
    await user.type(screen.getByLabelText(/nombre/i), "Vestido A editado");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // Row A left edit mode (the form is gone) and the router refreshed once.
    await waitFor(() =>
      expect(screen.queryByLabelText(/nombre/i)).not.toBeInTheDocument(),
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // Every row is editable again — both "Editar" buttons are back.
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(2);

    // And another row can still be opened for edit afterwards.
    await user.click(screen.getAllByRole("button", { name: "Editar" })[1]);
    expect(screen.getByLabelText(/nombre/i)).toHaveValue("Vestido B");
  });

  it("allows editing again after Cancelar closes the open row", async () => {
    const user = userEvent.setup();
    render(
      <table>
        <ProductTableBody products={products} categories={categories} />
      </table>,
    );

    await user.click(screen.getAllByRole("button", { name: "Editar" })[0]);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByLabelText(/nombre/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(2);
  });
});
