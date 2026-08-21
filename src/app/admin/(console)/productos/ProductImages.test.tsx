import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductImages } from "./ProductImages";

// Mirrors AddVariantForm.test.tsx's conventions: @testing-library/react +
// user-event, stubbed global.fetch, stubbed window.confirm, mocked
// next/navigation's useRouter. Backs specs/admin-console/spec.md "Owner
// adds an image to an existing product" and "Owner deletes an image,
// including the last remaining one". design.md G2 (client-side 5-image
// cap feedback), G8 (failed attach resets the file input, no URL-reuse
// retry). tasks.md 7.1/7.2.
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

function makeImage(overrides: Partial<{ id: string; url: string; altText: string | null; position: number }> = {}) {
  return {
    id: "img-1",
    productId: "prod-1",
    url: "/uploads/img-1.jpg",
    altText: null,
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function renderGallery(images: ReturnType<typeof makeImage>[]) {
  return render(
    <table>
      <tbody>
        <ProductImages productId="prod-1" images={images} />
      </tbody>
    </table>,
  );
}

function makeFile(name = "photo.jpg"): File {
  return new File(["bytes"], name, { type: "image/jpeg" });
}

describe("ProductImages", () => {
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

  it("renders one 64px thumbnail per images entry with alt={image.altText ?? \"\"}", () => {
    const { container } = renderGallery([
      makeImage({ id: "img-1", url: "/uploads/img-1.jpg", altText: "Vestido en percha" }),
      makeImage({ id: "img-2", url: "/uploads/img-2.jpg", altText: null }),
    ]);

    const thumbnails = container.querySelectorAll("img");
    expect(thumbnails).toHaveLength(2);
    expect(thumbnails[0]).toHaveAttribute("src", "/uploads/img-1.jpg");
    expect(thumbnails[0]).toHaveAttribute("alt", "Vestido en percha");
    expect(thumbnails[1]).toHaveAttribute("src", "/uploads/img-2.jpg");
    expect(thumbnails[1]).toHaveAttribute("alt", "");
  });

  it("sends no DELETE request when confirm() returns false", async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
    renderGallery([makeImage({ id: "img-1" })]);

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends DELETE .../images/{imageId} and calls router.refresh() on 200 when confirmed", async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "img-1" }),
    });
    renderGallery([makeImage({ id: "img-1" })]);

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/products/prod-1/images/img-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("renders a stubbed non-2xx DELETE response's message in role=alert and does not call router.refresh()", async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "image_not_found" }),
    });
    renderGallery([makeImage({ id: "img-1" })]);

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("disables the file input at 5 images and shows Máximo 5 imágenes. (G2)", () => {
    const fiveImages = Array.from({ length: 5 }, (_, i) => makeImage({ id: `img-${i}`, position: i }));
    renderGallery(fiveImages);

    expect(screen.getByLabelText(/Subir imagen/i)).toBeDisabled();
    expect(screen.getByText("Máximo 5 imágenes.")).toBeInTheDocument();
  });

  it("does not disable the file input below 5 images", () => {
    renderGallery([makeImage({ id: "img-1" })]);

    expect(screen.getByLabelText(/Subir imagen/i)).toBeEnabled();
    expect(screen.queryByText("Máximo 5 imágenes.")).not.toBeInTheDocument();
  });

  it("a failed attach after a successful upload resets the file input (key bump) and shows the reset message (G8), with no retry using the returned url", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ url: "/uploads/products/new-file.jpg" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: "too_many_images",
          message: "Máximo 5 imágenes por producto. Eliminá una antes de subir otra.",
          currentCount: 5,
        }),
      });
    renderGallery([makeImage({ id: "img-1" })]);

    const fileInput = screen.getByLabelText(/Subir imagen/i);
    await user.upload(fileInput, makeFile());

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/admin/upload",
      expect.objectContaining({ method: "POST" }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "/api/admin/products/prod-1/images",
      expect.objectContaining({ method: "POST" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Subimos la imagen pero no pudimos adjuntarla. Elegí el archivo otra vez.",
    );

    // key-bump reset: the (new) file input element has no selected file.
    const resetInput = screen.getByLabelText(/Subir imagen/i) as HTMLInputElement;
    expect(resetInput.files).toHaveLength(0);
    expect(refreshMock).not.toHaveBeenCalled();

    // No retry: only the 2 calls above ever happened, never a 3rd re-attach.
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("a successful upload + attach calls router.refresh()", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ url: "/uploads/products/new-file.jpg" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: "img-new", url: "/uploads/products/new-file.jpg", altText: null, position: 1 }),
      });
    renderGallery([makeImage({ id: "img-1" })]);

    await user.upload(screen.getByLabelText(/Subir imagen/i), makeFile());

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });
});
