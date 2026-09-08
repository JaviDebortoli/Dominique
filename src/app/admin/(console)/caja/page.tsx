// /admin/caja — the register screen (design.md "Admin /admin/caja (register
// screen, rule 4c)"). tasks.md 7.6/7.10.
//
// `dynamic = "force-dynamic"` — design.md's exact wording: staff must see
// truth, not stale data. No fetch cache, no revalidate window; every
// request re-reads Postgres via caja.service.ts's getCajaRows(). Combined
// with AutoRefresh's 15s client poll + manual button, this is the UI-level
// proof of the inventory-stock "Real-Time-Accurate Stock View" HARD RULE:
// a MercadoPago-confirmed payment's commitPaid() call and this page's next
// read race on the exact same row, and there is no caching layer anywhere
// in between that could serve a stale "still available" answer.
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { CajaRowActions } from "@/components/admin/CajaRowActions";
import { prisma } from "@/lib/db";
import { getCajaRows } from "@/modules/inventory/caja.service";

export const dynamic = "force-dynamic";

interface CajaPageProps {
  searchParams: Promise<{ q?: string }>;
}

function formatExpiry(expiresAt: Date | null): string {
  if (!expiresAt) return "—";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(
    expiresAt,
  );
}

export default async function CajaPage({ searchParams }: CajaPageProps) {
  const { q } = await searchParams;
  const rows = await getCajaRows(prisma, { search: q });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-headline-md text-ink">Caja</h1>
        <div className="flex flex-wrap items-center gap-3">
          <form className="flex min-w-0 gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Buscar por SKU o producto"
              className="min-w-0 flex-1 border border-ink/20 px-3 py-2 font-sans text-body-md sm:w-64 sm:flex-none"
            />
            <button
              type="submit"
              className="shrink-0 border border-ink/20 px-4 py-2 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface"
            >
              Buscar
            </button>
          </form>
          <AutoRefresh />
        </div>
      </div>

      <div className="overflow-x-auto border border-ink/15">
        <table className="w-full border-collapse font-sans text-body-md text-ink">
          <thead>
            <tr className="divide-x divide-ink/10 border-b border-ink/20 bg-surface text-left align-middle font-sans text-label-caps uppercase tracking-widest text-outline">
              <th className="px-4 py-3 font-semibold">Producto</th>
              <th className="px-4 py-3 font-semibold">Talle / Color</th>
              <th className="px-4 py-3 font-semibold">SKU</th>
              <th className="px-4 py-3 text-center font-semibold">Disponible</th>
              <th className="px-4 py-3 text-center font-semibold">Reservado</th>
              <th className="px-4 py-3 text-center font-semibold">En depósito</th>
              <th className="px-4 py-3 font-semibold">Reservas</th>
              <th className="px-4 py-3 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.variantId}
                className="divide-x divide-ink/10 border-b border-ink/10 align-middle last:border-b-0 hover:bg-surface"
              >
                <td className="px-4 py-3 font-medium">{row.productName}</td>
                <td className="px-4 py-3 text-on-surface-variant">
                  {row.size} / {row.color}
                </td>
                <td className="px-4 py-3 tabular-nums text-on-surface-variant">{row.sku}</td>
                <td className="px-4 py-3 text-center text-body-lg font-semibold tabular-nums">
                  {row.disponible}
                </td>
                <td className="px-4 py-3 text-center tabular-nums">{row.reservado}</td>
                <td className="px-4 py-3 text-center tabular-nums">{row.enDeposito}</td>
                <td className="px-4 py-3">
                  {row.reservations.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {row.reservations.map((reservation) => (
                        <li key={reservation.orderId} className="text-label-caps text-outline">
                          {reservation.buyerName} · {reservation.qty}u · vence{" "}
                          {formatExpiry(reservation.expiresAt)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-outline">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <CajaRowActions variantId={row.variantId} disponible={row.disponible} />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-outline">
                  Sin resultados.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
