// /admin/reportes — revenue report (control-de-caja design.md diagram (d),
// tasks.md 5.6). `dynamic = "force-dynamic"` for the same reason
// caja/page.tsx uses it: staff need a fresh read every request, no stale
// cache. Backs specs/admin-console/spec.md "Revenue Report Page and
// Navigation" and specs/sales-revenue/spec.md "Revenue Aggregation by
// Period and Payment Method".
import { prisma } from "@/lib/db";
import { resolveReportRange } from "@/lib/report-day";
import { getRevenueReport, type RevenueBucket } from "@/modules/reports/caja-report.service";
import { VoidSaleButton } from "@/components/admin/VoidSaleButton";

export const dynamic = "force-dynamic";

interface ReportesPageProps {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const BUCKET_LABELS_ES_AR: Record<RevenueBucket, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  MP: "MercadoPago",
  UNKNOWN: "Sin método registrado",
};

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export default async function ReportesPage({ searchParams }: ReportesPageProps) {
  const { desde, hasta } = await searchParams;
  const from = desde ?? todayStr();
  const to = hasta ?? desde ?? todayStr();

  const report = await getRevenueReport(prisma, { from, to });

  // Today's individual sales — independent of the filter above, always
  // "today" (design.md: Anular only ever applies to the current caja day,
  // so this list is the one staff actually act on).
  const todayRange = resolveReportRange({ from: todayStr(), to: todayStr() });
  const todaysSales = await prisma.sale.findMany({
    where: { soldAt: { gte: todayRange.from, lt: todayRange.to } },
    include: { variant: { include: { product: { select: { name: true } } } } },
    orderBy: { soldAt: "desc" },
  });

  // design.md Open Questions (unconfirmed): "show UNKNOWN always, or only
  // when non-zero". Defaulted to "only when non-zero" — a store with no
  // legacy PICKUP_CASH orders missing a method should never see an always-
  // empty, unexplained row.
  const buckets: RevenueBucket[] = ["CASH", "TRANSFER", "MP"];
  if (!report.totals.UNKNOWN.isZero()) {
    buckets.push("UNKNOWN");
  }

  return (
    <section className="flex flex-col gap-8">
      <h1 className="font-serif text-headline-md text-ink">Reportes</h1>

      <form className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 font-sans text-label-caps uppercase tracking-widest text-outline">
          Desde
          <input
            type="date"
            name="desde"
            defaultValue={from}
            className="border border-ink/20 px-3 py-2 font-sans text-body-md normal-case tracking-normal text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 font-sans text-label-caps uppercase tracking-widest text-outline">
          Hasta
          <input
            type="date"
            name="hasta"
            defaultValue={to}
            className="border border-ink/20 px-3 py-2 font-sans text-body-md normal-case tracking-normal text-ink"
          />
        </label>
        <button
          type="submit"
          className="border border-ink/20 px-4 py-2 font-sans text-label-caps uppercase tracking-widest text-ink hover:bg-surface"
        >
          Ver reporte
        </button>
      </form>

      {report.limitedData ? (
        <p role="status" className="border border-ink/20 bg-surface px-4 py-3 font-sans text-body-md text-ink">
          No hay datos de ventas en local para este período — el registro de ventas en local
          empezó a partir de esta actualización del sistema. Los totales de MercadoPago/retiro
          para este período, si existen, sí se muestran abajo.
        </p>
      ) : null}

      <div className="overflow-x-auto border border-ink/15">
        <table className="w-full border-collapse font-sans text-body-md text-ink">
          <thead>
            <tr className="divide-x divide-ink/10 border-b border-ink/20 bg-surface text-left align-middle font-sans text-label-caps uppercase tracking-widest text-outline">
              <th className="px-4 py-3 font-semibold">Método</th>
              <th className="px-4 py-3 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket} className="divide-x divide-ink/10 border-b border-ink/10 align-middle last:border-b-0">
                <td className="px-4 py-3">{BUCKET_LABELS_ES_AR[bucket]}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatMoney(report.totals[bucket].toNumber())}
                </td>
              </tr>
            ))}
            <tr className="divide-x divide-ink/10 bg-surface align-middle font-semibold">
              <td className="px-4 py-3">Total</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatMoney(report.grandTotal.toNumber())}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-serif text-body-lg font-semibold text-ink">Ventas de hoy</h2>
        <div className="overflow-x-auto border border-ink/15">
          <table className="w-full border-collapse font-sans text-body-md text-ink">
            <thead>
              <tr className="divide-x divide-ink/10 border-b border-ink/20 bg-surface text-left align-middle font-sans text-label-caps uppercase tracking-widest text-outline">
                <th className="px-4 py-3 font-semibold">Producto</th>
                <th className="px-4 py-3 text-center font-semibold">Cant.</th>
                <th className="px-4 py-3 font-semibold">Método</th>
                <th className="px-4 py-3 font-semibold">Hora</th>
                <th className="px-4 py-3 text-right font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {todaysSales.map((sale) => (
                <tr
                  key={sale.id}
                  className="divide-x divide-ink/10 border-b border-ink/10 align-middle last:border-b-0"
                >
                  <td className="px-4 py-3">
                    {sale.variant.product.name}
                    {sale.voidedAt ? (
                      <span className="ml-2 text-label-caps text-outline">(anulada)</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">{sale.qty}</td>
                  <td className="px-4 py-3">{BUCKET_LABELS_ES_AR[sale.paymentMethod]}</td>
                  <td className="px-4 py-3 tabular-nums text-on-surface-variant">
                    {formatDateTime(sale.soldAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <VoidSaleButton saleId={sale.id} voidedAt={sale.voidedAt} />
                    </div>
                  </td>
                </tr>
              ))}
              {todaysSales.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-outline">
                    Todavía no hay ventas registradas hoy.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
