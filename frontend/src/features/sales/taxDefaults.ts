/** Standard VAT/GST by ISO2 country. US and unknown -> 0 (sales tax is jurisdiction-based). */
const RATES: Record<string, number> = {
  DE: 19, AT: 20, CH: 8.1, FR: 20, IT: 22, ES: 21, NL: 21, BE: 21, PL: 23, SE: 25, DK: 25, FI: 25.5,
  NO: 25, IE: 23, PT: 23, CZ: 21, GB: 20, RU: 20, UA: 20, AU: 10, NZ: 15, CA: 5, IN: 18, JP: 10, SG: 9,
};

export function defaultTaxRate(countryCode?: string | null): number {
  return RATES[(countryCode ?? '').trim().toUpperCase()] ?? 0;
}

/** Rates offered in the line tax select: common rates plus the country default and any rate already in use. */
export function taxRateOptions(countryDefault: number, inUse: (string | number)[] = []): number[] {
  const set = new Set<number>([0, 5, 7, 10, 19, 20, countryDefault]);
  for (const r of inUse) {
    const n = Number(r);
    if (Number.isFinite(n) && n >= 0) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}
