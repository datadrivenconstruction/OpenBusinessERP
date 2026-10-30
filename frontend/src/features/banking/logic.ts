/** Pure helpers for the reconciliation workspace (kept separate so they unit-test without React). */

import type { Allocation, BankTransaction, CsvMapping, Suggestion } from './api';

export type Confidence = 'high' | 'medium' | 'low';

export function confidenceOf(score: number): Confidence {
  if (score >= 0.75) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

/** Open (not yet matched) part of a bank line, always positive. */
export function openAmount(t: Pick<BankTransaction, 'amount' | 'matched_amount'>): number {
  return Math.round((Math.abs(Number(t.amount)) - Number(t.matched_amount)) * 100) / 100;
}

export type KeyAction =
  | { type: 'move'; index: number }
  | { type: 'pick'; index: number }
  | { type: 'confirm' }
  | { type: 'ignore' }
  | { type: 'undo' }
  | { type: 'none' };

/**
 * Keyboard map: j/↓ next line, k/↑ previous, 1–5 select suggestion,
 * Enter accept the selected suggestion, u undo the line's matches, x ignore the line.
 */
export function keyAction(key: string, index: number, count: number): KeyAction {
  if (key === 'j' || key === 'ArrowDown') return { type: 'move', index: Math.min(index + 1, Math.max(count - 1, 0)) };
  if (key === 'k' || key === 'ArrowUp') return { type: 'move', index: Math.max(index - 1, 0) };
  if (/^[1-5]$/.test(key)) return { type: 'pick', index: Number(key) - 1 };
  if (key === 'Enter') return { type: 'confirm' };
  if (key === 'x') return { type: 'ignore' };
  if (key === 'u') return { type: 'undo' };
  return { type: 'none' };
}

/** Sum of allocations, to show what remains as a difference. */
export function allocated(allocs: Allocation[]): number {
  return Math.round(allocs.reduce((s, a) => s + Number(a.amount), 0) * 100) / 100;
}

/** Whether a suggestion leaves a small difference that a write-off could close. */
export function canWriteOff(s: Suggestion, max: number): boolean {
  const d = Math.abs(Number(s.difference));
  return d > 0 && d <= max;
}

/** First row of a CSV file → header names, guessing the delimiter like the server does. */
export function csvHeaders(firstLine: string): { delimiter: string; headers: string[] } {
  const counts = [';', '\t', ','].map((d) => [d, firstLine.split(d).length - 1] as const);
  const delimiter = counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  return { delimiter, headers: firstLine.split(delimiter).map((h) => h.trim().replace(/^"|"$/g, '')) };
}

const GUESS: Array<[keyof CsvMapping, RegExp]> = [
  ['date', /^(date|booking ?date|buchungs?tag|buchungsdatum|datum)$/i],
  ['value_date', /^(value ?date|valuta|wertstellung)$/i],
  ['amount', /^(amount|betrag|umsatz)$/i],
  ['debit', /^(debit|soll|withdrawal)$/i],
  ['credit', /^(credit|haben|deposit)$/i],
  ['currency', /^(currency|w[äa]hrung|ccy)$/i],
  ['counterparty_name', /(payee|payer|name|empf[äa]nger|auftraggeber|beg[üu]nstigter)/i],
  ['counterparty_iban', /iban/i],
  ['remittance', /(memo|purpose|verwendungszweck|description|reference text|text)/i],
  ['reference', /^(ref|reference|id|transaction id)$/i],
];

/** Best-effort initial mapping from header names; the user can change every field. */
export function guessMapping(headers: string[]): CsvMapping {
  const out: Partial<CsvMapping> = {};
  for (const [field, re] of GUESS) {
    const hit = headers.find((h) => re.test(h) && !Object.values(out).includes(h));
    if (hit) (out as Record<string, string>)[field] = hit;
  }
  return { date: '', ...out } as CsvMapping;
}

/** First data rows of a CSV for the mapping preview (handles quoted cells; not a full RFC 4180 parser). */
export function csvSample(text: string, delimiter: string, rows = 5): string[][] {
  const out: string[][] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
      } else if (c === delimiter && !quoted) {
        cells.push(cur.trim());
        cur = '';
      } else cur += c;
    }
    cells.push(cur.trim());
    out.push(cells);
    if (out.length >= rows) break;
  }
  return out;
}

/** Whether the CSV mapping is enough to parse: a date plus a signed amount or debit/credit. */
export function mappingReady(m: CsvMapping): boolean {
  return !!m.date && (!!m.amount || !!m.debit || !!m.credit);
}
