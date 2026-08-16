import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewCategoryForm } from "./NewCategoryForm";

// Mirrors CheckoutForm.test.tsx's conventions: @testing-library/react +
// user-event, stubbed global.fetch. Backs specs/admin-console/spec.md
// "Owner creates a category unaided", "Duplicate slug rejected", and
// "Slug auto-suggestion strips accents" (design.md: slugTouched flag, live
// /categoria/{slug} preview, router.refresh() on success). tasks.md 4.1/4.2.
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

describe("NewCategoryForm", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    refreshMock.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("auto-fills the slug field from the name via toSlug while the slug is untouched", async () => {
    const user = userEvent.setup();
    render(<NewCategoryForm />);

    await user.type(screen.getByLabelText(/^nombre/i), "Bijoutería");

    expect(screen.getByLabelText(/^slug/i)).toHaveValue("bijouteria");
  });

  it("stops auto-filling the slug once the owner hand-edits it", async () => {
    const user = userEvent.setup();
    render(<NewCategoryForm />);

    await user.type(screen.getByLabelText(/^nombre/i), "Bijoutería");
    const slugInput = screen.getByLabelText(/^slug/i);
    await user.clear(slugInput);
    await user.type(slugInput, "mi-slug-manual");

    // Further edits to name must NOT overwrite the hand-edited slug.
    await user.type(screen.getByLabelText(/^nombre/i), " Extra");

    expect(slugInput).toHaveValue("mi-slug-manual");
  });

  it("renders a stubbed 409 response's message inside role=alert", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "duplicate_slug",
        message: "Ya existe una categoría con esta URL.",
      }),
    });

    render(<NewCategoryForm />);
    await user.type(screen.getByLabelText(/^nombre/i), "Bijoutería");
    await user.click(screen.getByRole("button", { name: /crear categor[ií]a/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe una categoría con esta URL.",
    );
  });

  it("clears name/slug state and calls router.refresh() on a stubbed 201", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: "cat-1",
        name: "Bijoutería",
        slug: "bijouteria",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    });

    render(<NewCategoryForm />);
    await user.type(screen.getByLabelText(/^nombre/i), "Bijoutería");
    await user.click(screen.getByRole("button", { name: /crear categor[ií]a/i }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/^nombre/i)).toHaveValue("");
    expect(screen.getByLabelText(/^slug/i)).toHaveValue("");
  });
});
