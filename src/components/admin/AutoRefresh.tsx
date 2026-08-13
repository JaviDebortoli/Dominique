"use client";

// design.md "Admin /admin/caja (register screen, rule 4c)": "export const
// dynamic = 'force-dynamic', no cache, 15 s client poll + manual refresh".
// The page itself sets `dynamic = 'force-dynamic'` (see caja/page.tsx) so
// every render re-reads the DB; this component is the CLIENT half — it
// calls router.refresh() on an interval, which re-runs the Server
// Component's data fetch without a full page reload (so scroll position/
// search input state stay put), plus a manual button for "I need this
// NOW" (staff mid-sale).
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 15_000;

export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="border border-ink/20 px-4 py-2 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface"
    >
      Actualizar
    </button>
  );
}
