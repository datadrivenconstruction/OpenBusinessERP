/** API helpers for Purchasing (purchase-to-pay), backed by /api/v1/purchasing/. */

import { API_BASE, ApiError, apiDelete, apiGet, apiPatch, apiPost, fetchWithAuth } from '@/shared/lib/api';

export type PurchasingKind = 'orders' | 'bills' | 'credit-notes';
export type PurchasingTab = 'orders' | 'receipts' | 'bills';
export const PURCHASING_TABS: PurchasingTab[] = ['orders', 'receipts', 'bills'];
export const DOC_KINDS: PurchasingKind[] = ['orders', 'bills', 'credit-notes'];
export type MatchStatus = 'none' | 'matched' | 'price_variance' | 'qty_variance';

export interface PurchasingLine {
  id?: string;
  line_no?: number;
  item_id: string | null;
  order_line_id?: string | null;
  sku: string;
  description: string;
  qty: string;
  unit_price: string;
  tax_rate: string;
  net?: string;
  tax?: string;
  gross?: string;
  qty_received?: string;
  qty_billed?: string;
  remaining_qty?: string;
  discount_pct?: string;
  match_status?: MatchStatus;
}

export interface PurchasingPayment {
  id: string;
  pay_date: string;
  amount: string;
  method: string;
  reference: string;
  gl_entry_id: string | null;
}

export interface PurchasingDocSummary {
  id: string;
  number: string;
  status: string;
  supplier_id: string | null;
  supplier_name: string;
  currency: string;
  doc_date: string;
  due_date: string | null;
  net_total: string;
  tax_total: string;
  gross_total: string;
  kind?: 'bill' | 'credit_note';
  amount_paid?: string;
  match_status?: MatchStatus;
  order_id?: string | null;
  receipt_id?: string | null;
  source_id?: string | null;
  supplier_ref?: string;
  balance_due?: string;
  is_overdue?: boolean;
  received_pct?: number | string;
  payment_terms_days?: number | null;
}

export interface PurchasingDoc extends PurchasingDocSummary {
  fx_rate: string;
  notes: string;
  lines: PurchasingLine[];
  payments?: PurchasingPayment[];
}

export interface Receipt {
  id: string;
  number: string;
  status: string;
  order_id: string;
  order_number: string;
  supplier_name: string;
  currency: string;
  doc_date: string;
  value_total: string;
  gl_entry_id: string | null;
  notes: string;
  lines: { id: string; order_line_id: string; sku: string; description: string; qty: string; unit_cost: string; value: string; stock_tracked: boolean }[];
}

export interface PurchasingDocInput {
  supplier_id?: string | null;
  supplier_name?: string;
  supplier_ref?: string;
  currency?: string;
  doc_date?: string | null;
  due_date?: string | null;
  notes?: string;
  payment_terms_days?: number | null;
  lines?: Pick<PurchasingLine, 'item_id' | 'order_line_id' | 'sku' | 'description' | 'qty' | 'unit_price' | 'tax_rate' | 'discount_pct'>[];
}

export interface PurchasingSummary {
  currency: string;
  open_po_value: string;
  bills_due: string;
  overdue_count: number;
  overdue_value: string;
  payables: string;
}

export interface PurchasingStats {
  currency: string;
  open_po_count: number;
  open_po_value: string;
  to_receive_count: number;
  to_receive_value: string;
  bills_due_week_count: number;
  bills_due_week_value: string;
  overdue_count: number;
  overdue_value: string;
}

export interface ListQuery {
  status?: string[];
  supplier_id?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
  overdue?: boolean;
  match?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

export type BulkAction = 'mark_sent' | 'delete_drafts' | 'reminder_drafts';
export interface BulkResult {
  processed: number;
  skipped: { id: string; reason: string }[];
  drafts: unknown[];
}
export interface ActivityEntry {
  at: string;
  type: string;
  actor: string | null;
  message: string;
  ref_id: string | null;
}
export interface RelatedRef {
  id: string;
  number: string;
  status?: string;
  doc_date?: string;
  gross_total?: string;
  value_total?: string;
  currency?: string;
}
export interface OrderRelated {
  source: null;
  derived: { receipts: RelatedRef[]; bills: RelatedRef[] };
}
export interface BillRelated {
  source: { order: RelatedRef | null; receipt: RelatedRef | null } | null;
  derived: RelatedRef[];
}

export function listQueryString(f: ListQuery): string {
  const p = new URLSearchParams();
  if (f.status?.length) p.set('status', f.status.join(','));
  if (f.supplier_id) p.set('supplier_id', f.supplier_id);
  if (f.q) p.set('q', f.q);
  if (f.date_from) p.set('date_from', f.date_from);
  if (f.date_to) p.set('date_to', f.date_to);
  if (f.overdue) p.set('overdue', 'true');
  if (f.match) p.set('match', f.match);
  if (f.sort) p.set('sort', f.sort);
  if (f.limit != null) p.set('limit', String(f.limit));
  if (f.offset != null) p.set('offset', String(f.offset));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function getWithTotal<T>(path: string): Promise<{ items: T[]; total: number }> {
  const res = await fetchWithAuth(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new ApiError(res.status, res.statusText, await res.json().catch(() => null));
  const items = (await res.json()) as T[];
  const total = Number(res.headers.get('X-Total-Count') ?? items.length);
  return { items, total: Number.isFinite(total) ? total : items.length };
}

async function getBlob(path: string): Promise<Blob> {
  const res = await fetchWithAuth(`${API_BASE}${path}`);
  if (!res.ok) throw new ApiError(res.status, res.statusText, await res.json().catch(() => null));
  return res.blob();
}

const B = '/v1/purchasing';
const base = (kind: PurchasingKind) => `${B}/${kind}/`;

export const purchasingApi = {
  summary: () => apiGet<PurchasingSummary>(`${B}/summary/`),
  list: (kind: PurchasingKind) => apiGet<PurchasingDocSummary[]>(base(kind)),
  receipts: () => apiGet<Receipt[]>(`${B}/receipts/`),
  get: (kind: PurchasingKind, id: string) => apiGet<PurchasingDoc>(`${base(kind)}${id}/`),
  create: (kind: PurchasingKind, body: PurchasingDocInput) => apiPost<PurchasingDoc>(base(kind), body),
  update: (kind: PurchasingKind, id: string, body: PurchasingDocInput) => apiPatch<PurchasingDoc>(`${base(kind)}${id}/`, body),
  remove: (kind: PurchasingKind, id: string) => apiDelete(`${base(kind)}${id}/`),
  setOrderStatus: (id: string, status: string) => apiPost<PurchasingDoc>(`${B}/orders/${id}/status/`, { status }),
  receive: (id: string, lines?: { order_line_id: string; qty: string }[]) =>
    apiPost<Receipt>(`${B}/orders/${id}/receive/`, { lines: lines ?? null }),
  billFromOrder: (id: string) => apiPost<PurchasingDoc>(`${B}/orders/${id}/bill/`, {}),
  billFromReceipt: (id: string) => apiPost<PurchasingDoc>(`${B}/receipts/${id}/bill/`, {}),
  post: (kind: PurchasingKind, id: string) => apiPost<PurchasingDoc>(`${base(kind)}${id}/post/`, {}),
  cancel: (kind: PurchasingKind, id: string) => apiPost<PurchasingDoc>(`${base(kind)}${id}/cancel/`, {}),
  query: (kind: PurchasingKind, f: ListQuery) => getWithTotal<PurchasingDocSummary>(`${base(kind)}${listQueryString(f)}`),
  stats: () => apiGet<PurchasingStats>(`${B}/stats/`),
  duplicate: (kind: PurchasingKind, id: string) => apiPost<PurchasingDoc>(`${base(kind)}${id}/duplicate/`, {}),
  bulk: (kind: PurchasingKind, action: BulkAction, ids: string[]) =>
    apiPost<BulkResult>(`${base(kind)}bulk/`, { action, ids }),
  activity: (kind: PurchasingKind, id: string) => apiGet<ActivityEntry[]>(`${base(kind)}${id}/activity/`),
  orderRelated: (id: string) => apiGet<OrderRelated>(`${B}/orders/${id}/related/`),
  billRelated: (kind: PurchasingKind, id: string) => apiGet<BillRelated>(`${base(kind)}${id}/related/`),
  pdf: (kind: PurchasingKind, id: string) => getBlob(`${base(kind)}${id}/pdf/`),
  pay: (id: string, body: { amount: string; pay_date?: string; reference?: string }) =>
    apiPost<PurchasingDoc>(`${B}/bills/${id}/payments/`, body),
};

export const docKind = (d: Pick<PurchasingDocSummary, 'kind'>): PurchasingKind =>
  d.kind === 'credit_note' ? 'credit-notes' : d.kind === 'bill' ? 'bills' : 'orders';

export const STATUS_VARIANT: Record<string, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  draft: 'neutral',
  confirmed: 'blue',
  posted: 'blue',
  partially_received: 'warning',
  partially_paid: 'warning',
  received: 'success',
  paid: 'success',
  applied: 'success',
  closed: 'success',
  cancelled: 'error',
};

export const MATCH_VARIANT: Record<MatchStatus, 'neutral' | 'success' | 'warning' | 'error'> = {
  none: 'neutral',
  matched: 'success',
  price_variance: 'warning',
  qty_variance: 'error',
};
export const MATCH_LABEL: Record<MatchStatus, string> = {
  none: 'No PO',
  matched: 'Matched',
  price_variance: 'Price variance',
  qty_variance: 'Qty variance',
};

/** Same per-line half-up rounding as the server; discount_pct reduces net before tax. */
export function lineTotals(l: Pick<PurchasingLine, 'qty' | 'unit_price' | 'tax_rate'> & { discount_pct?: string }) {
  const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
  const disc = Math.min(100, Math.max(0, Number(l.discount_pct) || 0));
  const net = r2((Number(l.qty) || 0) * (Number(l.unit_price) || 0) * (1 - disc / 100));
  const tax = r2((net * (Number(l.tax_rate) || 0)) / 100);
  return { net, tax, gross: r2(net + tax) };
}

export { fmtMoney } from '@/features/sales/api';
