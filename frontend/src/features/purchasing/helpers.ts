/** Pure helpers for Purchasing: URL filters, totals per tax rate, CSV, status timeline, due tone. */
import { lineTotals, type ListQuery, type PurchasingDocSummary, type PurchasingLine } from './api';

export type ListTab = 'orders' | 'receipts' | 'bills';

export interface ListFilters {
  status: string[];
  supplier_id: string;
  supplier_name: string;
  q: string;
  date_from: string;
  date_to: string;
  overdue: boolean;
  match: string;
  sort: string;
}

export const DEFAULT_SORT = '-doc_date';
export const EMPTY_FILTERS: ListFilters = {
  status: [],
  supplier_id: '',
  supplier_name: '',
  q: '',
  date_from: '',
  date_to: '',
  overdue: false,
  match: '',
  sort: DEFAULT_SORT,
};

export function filtersFromParams(p: URLSearchParams): ListFilters {
  return {
    status: (p.get('status') ?? '').split(',').filter(Boolean),
    supplier_id: p.get('supplier_id') ?? '',
    supplier_name: p.get('supplier') ?? '',
    q: p.get('q') ?? '',
    date_from: p.get('from') ?? '',
    date_to: p.get('to') ?? '',
    overdue: p.get('overdue') === '1',
    match: p.get('match') ?? '',
    sort: p.get('sort') || DEFAULT_SORT,
  };
}

/** Writes filters into a copy of `p`; empty values are removed so URLs stay short. */
export function filtersToParams(f: ListFilters, p: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const out = new URLSearchParams(p);
  const put = (k: string, v: string) => (v ? out.set(k, v) : out.delete(k));
  put('status', f.status.join(','));
  put('supplier_id', f.supplier_id);
  put('supplier', f.supplier_id ? f.supplier_name : '');
  put('q', f.q);
  put('from', f.date_from);
  put('to', f.date_to);
  put('overdue', f.overdue ? '1' : '');
  put('match', f.match);
  put('sort', f.sort === DEFAULT_SORT ? '' : f.sort);
  return out;
}

export function activeFilterCount(f: ListFilters): number {
  return (
    (f.status.length ? 1 : 0) +
    (f.supplier_id ? 1 : 0) +
    (f.q ? 1 : 0) +
    (f.date_from || f.date_to ? 1 : 0) +
    (f.overdue ? 1 : 0) +
    (f.match ? 1 : 0)
  );
}

export function toListQuery(f: ListFilters, limit: number, offset: number): ListQuery {
  return {
    status: f.status,
    supplier_id: f.supplier_id || undefined,
    q: f.q || undefined,
    date_from: f.date_from || undefined,
    date_to: f.date_to || undefined,
    overdue: f.overdue || undefined,
    match: f.match || undefined,
    sort: f.sort,
    limit,
    offset,
  };
}

/** Clicking a header: same field toggles direction, new field starts descending for dates/money. */
export function nextSort(current: string, field: string): string {
  const cur = current.replace(/^-/, '');
  if (cur === field) return current.startsWith('-') ? field : `-${field}`;
  return ['doc_date', 'due_date', 'gross_total', 'net_total', 'balance_due'].includes(field) ? `-${field}` : field;
}

export interface TaxBucket {
  rate: number;
  net: number;
  tax: number;
}

export function totalsByTaxRate(lines: Pick<PurchasingLine, 'qty' | 'unit_price' | 'tax_rate' | 'discount_pct'>[]) {
  const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
  const map = new Map<number, TaxBucket>();
  let net = 0;
  let tax = 0;
  for (const l of lines) {
    const x = lineTotals(l);
    const rate = Number(l.tax_rate) || 0;
    const b = map.get(rate) ?? { rate, net: 0, tax: 0 };
    b.net = r2(b.net + x.net);
    b.tax = r2(b.tax + x.tax);
    map.set(rate, b);
    net = r2(net + x.net);
    tax = r2(tax + x.tax);
  }
  const buckets = [...map.values()].sort((a, b) => b.rate - a.rate);
  return { buckets, net, tax, gross: r2(net + tax) };
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function docsToCsv(docs: PurchasingDocSummary[]): string {
  return toCsv(
    ['Number', 'Supplier', 'Date', 'Due date', 'Status', 'Currency', 'Net', 'Tax', 'Gross', 'Balance due'],
    docs.map((d) => [
      d.number,
      d.supplier_name,
      d.doc_date,
      d.due_date ?? '',
      d.status,
      d.currency,
      d.net_total,
      d.tax_total,
      d.gross_total,
      d.balance_due ?? '',
    ]),
  );
}

export type TimelineStep = 'ordered' | 'received' | 'billed' | 'paid';
export type StepState = 'done' | 'partial' | 'todo' | 'skipped';
export const TIMELINE_STEPS: TimelineStep[] = ['ordered', 'received', 'billed', 'paid'];

/** PO -> received -> billed -> paid progress from what the document and its relations say. */
export function buildTimeline(input: {
  kind: 'orders' | 'bills' | 'credit-notes';
  status: string;
  receivedPct?: number;
  billCount?: number;
  hasOrder?: boolean;
  hasReceipt?: boolean;
  balanceDue?: number;
  gross?: number;
}): Record<TimelineStep, StepState> {
  const { kind, status } = input;
  if (status === 'cancelled') return { ordered: 'skipped', received: 'skipped', billed: 'skipped', paid: 'skipped' };
  if (kind === 'orders') {
    const pct = input.receivedPct ?? (status === 'received' || status === 'closed' ? 100 : 0);
    return {
      ordered: status === 'draft' ? 'todo' : 'done',
      received: pct >= 100 ? 'done' : pct > 0 || status === 'partially_received' ? 'partial' : 'todo',
      billed: (input.billCount ?? 0) > 0 ? 'done' : 'todo',
      paid: 'todo',
    };
  }
  const gross = input.gross ?? 0;
  const due = input.balanceDue ?? gross;
  return {
    ordered: input.hasOrder ? 'done' : 'skipped',
    received: input.hasReceipt ? 'done' : input.hasOrder ? 'todo' : 'skipped',
    billed: status === 'draft' ? 'partial' : 'done',
    paid: ['paid', 'applied'].includes(status) || (status !== 'draft' && gross > 0 && due <= 0) ? 'done' : due < gross ? 'partial' : 'todo',
  };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : first.slice(1);
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

/** 'overdue' past due and unpaid, 'soon' due within 7 days, else 'normal'. */
export function dueTone(due: string | null | undefined, open: boolean, today = new Date()): 'overdue' | 'soon' | 'normal' {
  if (!due || !open) return 'normal';
  const d = new Date(`${due}T00:00:00`);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((d.getTime() - t0.getTime()) / 86400000);
  if (days < 0) return 'overdue';
  return days <= 7 ? 'soon' : 'normal';
}

export function balanceDue(d: Pick<PurchasingDocSummary, 'balance_due' | 'gross_total' | 'amount_paid'>): number {
  if (d.balance_due != null) return Number(d.balance_due) || 0;
  return (Number(d.gross_total) || 0) - (Number(d.amount_paid) || 0);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Groups selected bills by currency for a payment run summary. */
export function paymentRun(bills: PurchasingDocSummary[]) {
  const by = new Map<string, { currency: string; count: number; total: number; suppliers: Set<string> }>();
  for (const b of bills) {
    const due = balanceDue(b);
    if (due <= 0 || b.kind === 'credit_note') continue;
    const g = by.get(b.currency) ?? { currency: b.currency, count: 0, total: 0, suppliers: new Set<string>() };
    g.count += 1;
    g.total = Math.round((g.total + due) * 100) / 100;
    g.suppliers.add(b.supplier_name || '—');
    by.set(b.currency, g);
  }
  return [...by.values()].map((g) => ({ currency: g.currency, count: g.count, total: g.total, suppliers: g.suppliers.size }));
}

export interface LineError {
  description?: string;
  qty?: string;
  unit_price?: string;
  discount_pct?: string;
}

export function validateLines(lines: Pick<PurchasingLine, 'description' | 'qty' | 'unit_price' | 'discount_pct'>[]): LineError[] {
  return lines.map((l) => {
    const e: LineError = {};
    if (!l.description.trim()) e.description = 'required';
    if (!(Number(l.qty) > 0)) e.qty = 'positive';
    if (l.unit_price === '' || Number.isNaN(Number(l.unit_price)) || Number(l.unit_price) < 0) e.unit_price = 'invalid';
    const d = Number(l.discount_pct || 0);
    if (Number.isNaN(d) || d < 0 || d > 100) e.discount_pct = 'range';
    return e;
  });
}

/** Client-side sort, used when two endpoints (bills + credit notes) are merged into one list. */
export function sortDocs<T extends PurchasingDocSummary>(rows: T[], sort: string): T[] {
  const desc = sort.startsWith('-');
  const f = sort.replace(/^-/, '') as keyof PurchasingDocSummary;
  const num = ['gross_total', 'net_total', 'balance_due'].includes(f as string);
  const val = (r: T) => (f === 'balance_due' ? balanceDue(r) : num ? Number(r[f]) || 0 : String(r[f] ?? ''));
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return desc ? -c : c;
  });
}
