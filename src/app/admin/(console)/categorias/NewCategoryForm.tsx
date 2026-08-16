"use client";

// Client form for /admin/categorias — mirrors NewProductForm.tsx's shape,
// but stays on the same page on success (design.md C5: router.refresh(),
// no redirect) so the owner can add several categories in a row. tasks.md
// 4.1/4.2.
//
// Slug auto-follows `name` through toSlug() (src/lib/slugify.ts — the SAME
// pure function the server route validates against, design.md C1) until
// the owner hand-edits the slug field, tracked by `slugTouched`. The live
// `/categoria/{slug}` preview shows the actual consequence of the field,
// since a wrong slug is the real failure mode this form guards against.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toSlug } from "@/lib/slugify";

export function NewCategoryForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(toSlug(value));
    }
  }

  function handleSlugChange(value: string) {
    setSlugTouched(true);
    setSlug(value);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, slug }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setErrorMessage(body.message ?? "No pudimos guardar la categoría.");
        setStatus("error");
        return;
      }

      setName("");
      setSlug("");
      setSlugTouched(false);
      setStatus("idle");
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Error inesperado.");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-4">
      <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
        Nombre
        <input
          required
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          className="border border-ink/20 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
        Slug
        <input
          required
          value={slug}
          onChange={(e) => handleSlugChange(e.target.value)}
          className="border border-ink/20 px-3 py-2"
        />
        <span className="font-sans text-body-sm text-outline">/categoria/{slug || "…"}</span>
      </label>

      {errorMessage ? (
        <p role="alert" className="font-sans text-body-md text-red-700">
          {errorMessage}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-fit bg-nude px-8 py-3 font-sans text-label-caps uppercase tracking-widest text-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "submitting" ? "Guardando…" : "Crear categoría"}
      </button>
    </form>
  );
}
