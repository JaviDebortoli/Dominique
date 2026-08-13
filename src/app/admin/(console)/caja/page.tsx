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
        <div className="flex items-center gap-4">
          <form className="flex gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Buscar por SKU o producto"
              className="border border-ink/20 px-3 py-2 font-sans text-body-md"
            />
            <button
              type="submit"
              className="border border-ink/20 px-4 py-2 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface"
            >
              Buscar
            </button>
          </form>
          <AutoRefresh />
        </div>
      </div>

      <table className="w-full border-collapse font-sans text-body-md text-ink">
        <thead>
          <tr className="border-b border-ink/20 text-left">
            <th className="py-2">Producto</th>
            <th className="py-2">Talle/Color</th>
            <th className="py-2">SKU</th>
            <th className="py-2 text-right">Disponible</th>
            <th className="py-2 text-right">Reservado</th>
            <th className="py-2 text-right">En depósito</th>
            <th className="py-2">Reservas</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.variantId} className="border-b border-ink/10 align-top">
              <td className="py-2">{row.productName}</td>
              <td className="py-2">
                {row.size} / {row.color}
              </td>
              <td className="py-2">{row.sku}</td>
              <td className="py-2 text-right font-semibold">{row.disponible}</td>
              <td className="py-2 text-right">{row.reservado}</td>
              <td className="py-2 text-right">{row.enDeposito}</td>
              <td className="py-2">
                {row.reservations.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {row.reservations.map((reservation) => (
                      <li key={reservation.orderId} className="text-label-caps text-outline">
                        {reservation.buyerName} · {reservation.qty}u · vence {formatExpiry(reservation.expiresAt)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-outline">—</span>
                )}
              </td>
              <td className="py-2">
                <CajaRowActions variantId={row.variantId} disponible={row.disponible} />
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-6 text-center text-outline">
                Sin resultados.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
