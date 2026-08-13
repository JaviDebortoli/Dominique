const ARS_FORMATTER = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Formats an amount (in whole/fractional pesos) as an Argentine peso string,
 * e.g. formatPriceARS(15000) -> "$15.000".
 */
export function formatPriceARS(amount: number): string {
  return ARS_FORMATTER.format(Math.round(amount)).replace(/ /g, "");
}
