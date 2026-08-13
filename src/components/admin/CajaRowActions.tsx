"use client";

// In-store sale ("Vender en local", tasks.md 7.7) and manual stock
// correction (tasks.md 7.8) actions for a single /admin/caja row. Both call
// their thin API routes (src/app/api/admin/stock/{sell,adjust}/route.ts)
// and then router.refresh() so the SAME force-dynamic server read that
// backs the whole caja table (design.md rule 4c) reflects the change —
// no separate client-side cache to invalidate.
import { useState } from "react";
import { useRouter } from "next/navigation";

export function CajaRowActions({ variantId, disponible }: { variantId: string; disponible: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sell() {
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/admin/stock/sell", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId, qty: 1 }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? "No se pudo vender.");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function adjust(delta: number) {
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/admin/stock/adjust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId, delta }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? "No se pudo ajustar.");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={sell}
          disabled={pending || disponible <= 0}
          className="border border-ink/20 px-3 py-1 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          Vender 1
        </button>
        <button
          type="button"
          onClick={() => adjust(1)}
          disabled={pending}
          className="border border-ink/20 px-3 py-1 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          +1
        </button>
        <button
          type="button"
          onClick={() => adjust(-1)}
          disabled={pending}
          className="border border-ink/20 px-3 py-1 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          -1
        </button>
      </div>
      {error ? (
        <p role="alert" className="font-sans text-label-caps text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
