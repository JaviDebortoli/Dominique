import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewProductForm } from "./NewProductForm";

// Covers the right-side image panel added to the create form: local
// previews (URL.createObjectURL) of not-yet-uploaded files, per-image
// "Quitar", and the 5-image client cap. jsdom has no URL.createObjectURL,
// so it is stubbed per test. The product/upload POST paths are unchanged
// and already covered elsewhere, so fetch is left untouched here.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const categories = [{ id: "c1", name: "Vestidos" }];

function makeFile(name: string): File {
  return new File(["bytes"], name, { type: "image/jpeg" });
}

describe("NewProductForm image panel", () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    let counter = 0;
    URL.createObjectURL = vi.fn(() => `blob:preview-${counter++}`);
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("renders the image panel with the file picker, the format hint, and an empty state", () => {
    render(<NewProductForm categories={categories} />);

    expect(screen.getByRole("heading", { name: "Imágenes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Elegir archivos")).toBeInTheDocument();
    expect(screen.getByText(/JPEG, PNG o WEBP/)).toBeInTheDocument();
    expect(screen.getByText(/Todavía no elegiste imágenes/)).toBeInTheDocument();
  });

  it("shows a preview per picked file and drops one when 'Quitar' is clicked", async () => {
    const user = userEvent.setup();
    render(<NewProductForm categories={categories} />);

    await user.upload(screen.getByLabelText("Elegir archivos"), [
      makeFile("a.jpg"),
      makeFile("b.jpg"),
    ]);

    expect(screen.getByRole("img", { name: "Vista previa 1" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Vista previa 2" })).toBeInTheDocument();

    const panel = screen.getByRole("list");
    await user.click(within(panel).getAllByRole("button", { name: "Quitar" })[0]);

    expect(screen.getByRole("img", { name: "Vista previa 1" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Vista previa 2" })).not.toBeInTheDocument();
  });

  it("caps the selection at 5 images and hides the picker once full", async () => {
    const user = userEvent.setup();
    render(<NewProductForm categories={categories} />);

    await user.upload(
      screen.getByLabelText("Elegir archivos"),
      Array.from({ length: 6 }, (_, i) => makeFile(`img-${i}.jpg`)),
    );

    expect(screen.getAllByRole("img")).toHaveLength(5);
    expect(screen.getByText("Máximo 5 imágenes.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Elegir archivos")).not.toBeInTheDocument();
  });
});

describe("NewProductForm SKU auto-fill", () => {
  it("derives the SKU from the product name, size and color as they are typed", async () => {
    const user = userEvent.setup();
    render(<NewProductForm categories={categories} />);

    await user.type(screen.getByLabelText("Nombre"), "Vestido Roma");
    await user.type(screen.getByPlaceholderText("Talle"), "S");
    await user.type(screen.getByPlaceholderText("Color"), "Negro");

    expect(screen.getByPlaceholderText("SKU (automático)")).toHaveValue("VEST-S-NEG");
  });

  it("keeps a hand-typed SKU when the name/size/color change afterward", async () => {
    const user = userEvent.setup();
    render(<NewProductForm categories={categories} />);

    await user.type(screen.getByPlaceholderText("Talle"), "M");
    const sku = screen.getByPlaceholderText("SKU (automático)");
    await user.clear(sku);
    await user.type(sku, "CUSTOM-1");

    await user.type(screen.getByLabelText("Nombre"), "Nombre Nuevo");
    await user.type(screen.getByPlaceholderText("Color"), "Rojo");

    expect(sku).toHaveValue("CUSTOM-1");
  });

  it("resumes auto-deriving the SKU for a row whose SKU field was cleared", async () => {
    const user = userEvent.setup();
    render(<NewProductForm categories={categories} />);

    await user.type(screen.getByLabelText("Nombre"), "Campera Norte");
    await user.type(screen.getByPlaceholderText("Talle"), "L");
    await user.type(screen.getByPlaceholderText("Color"), "Verde");
    const sku = screen.getByPlaceholderText("SKU (automático)");
    expect(sku).toHaveValue("CAMP-L-VER");

    await user.clear(sku);
    await user.type(sku, "TEMP");
    expect(sku).toHaveValue("TEMP");

    await user.clear(sku);
    await user.clear(screen.getByPlaceholderText("Talle"));
    await user.type(screen.getByPlaceholderText("Talle"), "XL");

    expect(sku).toHaveValue("CAMP-XL-VER");
  });
});

describe("NewProductForm slug auto-fill", () => {
  it("auto-fills the slug from the name via toSlug while it is untouched", async () => {
    const user = userEvent.setup();
    render(<NewProductForm categories={categories} />);

    await user.type(screen.getByLabelText("Nombre"), "Vestido de Baño");

    expect(screen.getByLabelText(/^slug/i)).toHaveValue("vestido-de-bano");
  });

  it("stops auto-filling once the slug is hand-edited", async () => {
    const user = userEvent.setup();
    render(<NewProductForm categories={categories} />);

    await user.type(screen.getByLabelText("Nombre"), "Remera");
    const slug = screen.getByLabelText(/^slug/i);
    await user.clear(slug);
    await user.type(slug, "mi-slug-manual");
    await user.type(screen.getByLabelText("Nombre"), " Basica");

    expect(slug).toHaveValue("mi-slug-manual");
  });

  it("resumes auto-filling after the slug field is cleared", async () => {
    const user = userEvent.setup();
    render(<NewProductForm categories={categories} />);

    await user.type(screen.getByLabelText("Nombre"), "Campera");
    const slug = screen.getByLabelText(/^slug/i);
    expect(slug).toHaveValue("campera");

    await user.clear(slug);
    await user.type(slug, "x");
    expect(slug).toHaveValue("x");

    await user.clear(slug);
    await user.type(screen.getByLabelText("Nombre"), " Norte");

    expect(slug).toHaveValue("campera-norte");
  });
});
