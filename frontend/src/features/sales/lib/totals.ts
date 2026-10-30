/** Document totals, grouped per tax rate the way they print on an invoice. */
import { lineTotals, type SalesLine } from '../api';

type LineLike = Pick<SalesLine, 'qty' | 'unit_price' | 'discount_pct' | 'tax_rate'>;

export interface TaxGroup {
  rate: number;
  net: number;
  tax: number;
}

export interface DocTotals {
  net: number;
  tax: number;
  gross: number;
  discount: number;
  groups: TaxGroup[];
}

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export function computeTotals(lines: LineLike[]): DocTotals {
  const byRate = new Map<number, TaxGroup>();
  let net = 0;
  let tax = 0;
  let discount = 0;
  for (const l of lines) {
    const x = lineTotals(l);
    const rate = Number(l.tax_rate) || 0;
    const g = byRate.get(rate) ?? { rate, net: 0, tax: 0 };
    g.net = r2(g.net + x.net);
    g.tax = r2(g.tax + x.tax);
    byRate.set(rate, g);
    net = r2(net + x.net);
    tax = r2(tax + x.tax);
    const list = (Number(l.qty) || 0) * (Number(l.unit_price) || 0);
    discount = r2(discount + (list - x.net));
  }
  const groups = [...byRate.values()].sort((a, b) => b.rate - a.rate);
  return { net, tax, gross: r2(net + tax), discount, groups };
}

/** ISO date plus N days; '' when the date is missing or invalid. */
export function addDays(iso: string, days: number): string {
  if (!iso || !Number.isFinite(days)) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Net days from payment terms like "Net 30" / "30 days"; null when none. */
export function termsDays(terms: string): number | null {
  const m = /(\d{1,3})/.exec(terms ?? '');
  return m ? Number(m[1]) : null;
}

export function balanceDue(d: { balance_due?: string; gross_total: string; amount_paid: string }): number {
  if (d.balance_due != null && d.balance_due !== '') return Number(d.balance_due) || 0;
  return r2((Number(d.gross_total) || 0) - (Number(d.amount_paid) || 0));
}

/** Server flag wins; otherwise an open invoice whose due date is before today. */
export function isOverdue(
  d: { is_overdue?: boolean; due_date: string | null; status: string; kind: string },
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (d.is_overdue != null) return d.is_overdue;
  if (d.kind !== 'invoice' || !d.due_date) return false;
  if (['paid', 'cancelled', 'draft'].includes(d.status)) return false;
  return d.due_date < today;
}

export interface LineError {
  index: number;
  field: 'description' | 'qty' | 'unit_price' | 'discount_pct';
  code: 'required' | 'positive' | 'range';
}

/** Inline validation of the line editor; empty array when the lines can be saved. */
export function validateLines(
  lines: Pick<SalesLine, 'description' | 'sku' | 'qty' | 'unit_price' | 'discount_pct'>[],
): LineError[] {
  const out: LineError[] = [];
  lines.forEach((l, index) => {
    if (!l.description.trim() && !l.sku.trim()) out.push({ index, field: 'description', code: 'required' });
    if (!(Number(l.qty) > 0)) out.push({ index, field: 'qty', code: 'positive' });
    if (!(Number(l.unit_price) >= 0)) out.push({ index, field: 'unit_price', code: 'positive' });
    const d = Number(l.discount_pct || 0);
    if (!(d >= 0 && d <= 100)) out.push({ index, field: 'discount_pct', code: 'range' });
  });
  return out;
}

/** Move an array element (drag-and-drop reorder). */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = arr.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x as T);
  return next;
}
