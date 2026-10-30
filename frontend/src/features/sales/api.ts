/** API helpers for the Sales (order-to-cash) module, backed by /api/v1/sales/. */

import {
  API_BASE,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  extractErrorMessageFromBody,
  fetchWithAuth,
  getAuthToken,
} from '@/shared/lib/api';
import { fmtCurrency } from '@/shared/lib/formatters';

export type SalesKind = 'quotes' | 'orders' | 'invoices' | 'credit-notes';
export const SALES_KINDS: SalesKind[] = ['quotes', 'orders', 'invoices', 'credit-notes'];
export type DocKind = 'quote' | 'order' | 'invoice' | 'credit_note';
export const DOC_LANGUAGES = ['en', 'de', 'ru', 'fr', 'es', 'it', 'pl'] as const;

export interface SalesLine {
  id?: string;
  line_no?: number;
  item_id?: string | null;
  sku: string;
  description: string;
  qty: string;
  unit_price: string;
  discount_pct: string;
  tax_rate: string;
  net?: string;
  tax?: string;
  gross?: string;
  /** Quantity not yet carried into a derived document (orders/quotes). */
  remaining_qty?: string;
}

export interface SalesPayment {
  id: string;
  pay_date: string;
  amount: string;
  method: string;
  reference: string;
  gl_entry_id: string | null;
}

export interface SalesDocSummary {
  id: string;
  kind: DocKind;
  number: string;
  status: string;
  customer_id: string | null;
  customer_name: string;
  currency: string;
  doc_date: string;
  due_date: string | null;
  net_total: string;
  tax_total: string;
  gross_total: string;
  amount_paid: string;
  source_id: string | null;
  gl_entry_id: string | null;
  balance_due?: string;
  is_overdue?: boolean;
}

export interface SalesDoc extends SalesDocSummary {
  fx_rate: string;
  notes: string;
  customer_address: string;
  customer_vat_id: string;
  customer_email: string;
  language: string;
  delivery_date: string | null;
  delivery_end: string | null;
  tax_note: string;
  payment_terms?: string;
  lines: SalesLine[];
  payments: SalesPayment[];
}

export interface SalesDocInput {
  customer_id?: string | null;
  customer_name?: string;
  currency?: string;
  doc_date?: string | null;
  due_date?: string | null;
  notes?: string;
  customer_address?: string;
  customer_vat_id?: string;
  customer_email?: string;
  language?: string;
  delivery_date?: string | null;
  delivery_end?: string | null;
  tax_note?: string;
  payment_terms?: string;
  lines?: Omit<SalesLine, 'id' | 'line_no' | 'net' | 'tax' | 'gross'>[];
}

export interface CheckIssue {
  field: string;
  message: string;
}

export interface EmailDraft {
  to: string;
  cc: string[];
  subject: string;
  body: string;
  filename: string;
  issues: CheckIssue[];
}

export interface SendLogEntry {
  id: string;
  sent_by: string | null;
  sent_at: string;
  to_addr: string;
  cc: string[];
  subject: string;
  status: 'sent' | 'failed';
  detail: string;
  backend: string;
}

export interface SendBody {
  to: string;
  cc: string[];
  subject: string;
  body: string;
}

export interface SalesSummary {
  currency: string;
  receivables: string;
  overdue_count: number;
  open_quotes_value: string;
  open_orders_value: string;
  payables: string | null;
  revenue_this_month: string;
  revenue_by_month: { month: string; revenue: string }[];
  top_customers?: { customer_id: string | null; customer_name: string; revenue: string; invoices: number }[];
  top_items?: { item_id: string | null; sku: string; name: string; qty: string; revenue: string }[];
}

export interface SalesStats {
  currency: string;
  open_quotes_count: number;
  open_quotes_value: string;
  win_rate: number | null;
  orders_to_invoice_count: number;
  orders_to_invoice_value: string;
  invoiced_this_month: string;
  overdue_count: number;
  overdue_value: string;
}

export type SalesSort = 'doc_date' | '-doc_date' | 'number' | '-number' | 'customer_name' | '-customer_name'
  | 'due_date' | '-due_date' | 'gross_total' | '-gross_total' | 'balance_due' | '-balance_due';

export interface SalesListQuery {
  status?: string[];
  customer_id?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
  overdue?: boolean;
  sort?: string;
  limit?: number;
  offset?: number;
}

export interface SalesListPage {
  items: SalesDocSummary[];
  total: number;
}

export type BulkAction = 'mark_sent' | 'delete_drafts' | 'reminder_drafts';
export interface ReminderDraft {
  id: string;
  number: string;
  to: string;
  subject: string;
  body: string;
}
export interface BulkResult {
  processed: number;
  skipped: { id: string; reason: string }[];
  drafts: ReminderDraft[];
}

export interface ActivityEntry {
  at: string;
  type: string;
  actor: string | null;
  message: string;
  ref_id: string | null;
}

export interface RelatedDocs {
  source: SalesDocSummary | null;
  derived: SalesDocSummary[];
}

export interface ConvertBody {
  lines?: { line_id: string; qty: string }[];
}

const base = (kind: SalesKind) => `/v1/sales/${kind}/`;

/** Query string for the list endpoint; empty values are dropped. */
export function listQueryString(q: SalesListQuery): string {
  const p = new URLSearchParams();
  if (q.status?.length) p.set('status', q.status.join(','));
  if (q.customer_id) p.set('customer_id', q.customer_id);
  if (q.q) p.set('q', q.q);
  if (q.date_from) p.set('date_from', q.date_from);
  if (q.date_to) p.set('date_to', q.date_to);
  if (q.overdue) p.set('overdue', 'true');
  if (q.sort) p.set('sort', q.sort);
  if (q.limit != null) p.set('limit', String(q.limit));
  if (q.offset != null) p.set('offset', String(q.offset));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** List with total from X-Total-Count; tolerates a bare array or a {items,total} page. */
export async function fetchSalesList(kind: SalesKind, q: SalesListQuery): Promise<SalesListPage> {
  const res = await fetchWithAuth(`${API_BASE}${base(kind)}${listQueryString(q)}`, { headers: { Accept: 'application/json' } });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(extractErrorMessageFromBody(body) ?? `HTTP ${res.status}`);
  const items = Array.isArray(body) ? (body as SalesDocSummary[]) : ((body as { items?: SalesDocSummary[] })?.items ?? []);
  const header = Number(res.headers.get('X-Total-Count'));
  const total = Number.isFinite(header) && res.headers.has('X-Total-Count')
    ? header
    : ((body as { total?: number })?.total ?? items.length);
  return { items, total };
}

export const salesApi = {
  summary: (months?: number) => apiGet<SalesSummary>(`/v1/sales/summary/${months ? `?months=${months}` : ''}`),
  list: (kind: SalesKind) => apiGet<SalesDocSummary[]>(base(kind)),
  get: (kind: SalesKind, id: string) => apiGet<SalesDoc>(`${base(kind)}${id}/`),
  create: (kind: SalesKind, body: SalesDocInput) => apiPost<SalesDoc>(base(kind), body),
  update: (kind: SalesKind, id: string, body: SalesDocInput) => apiPatch<SalesDoc>(`${base(kind)}${id}/`, body),
  remove: (kind: SalesKind, id: string) => apiDelete(`${base(kind)}${id}/`),
  setStatus: (kind: SalesKind, id: string, status: string) =>
    apiPost<SalesDoc>(`${base(kind)}${id}/status/`, { status }),
  quoteToOrder: (id: string, body: ConvertBody = {}) => apiPost<SalesDoc>(`/v1/sales/quotes/${id}/convert-to-order/`, body),
  orderToInvoice: (id: string, body: ConvertBody = {}) => apiPost<SalesDoc>(`/v1/sales/orders/${id}/convert-to-invoice/`, body),
  stats: () => apiGet<SalesStats>('/v1/sales/stats/'),
  duplicate: (kind: SalesKind, id: string) => apiPost<SalesDoc>(`${base(kind)}${id}/duplicate/`, {}),
  bulk: (kind: SalesKind, action: BulkAction, ids: string[]) => apiPost<BulkResult>(`${base(kind)}bulk/`, { action, ids }),
  activity: (kind: SalesKind, id: string) => apiGet<ActivityEntry[]>(`${base(kind)}${id}/activity/`),
  related: (kind: SalesKind, id: string) => apiGet<RelatedDocs>(`${base(kind)}${id}/related/`),
  issue: (id: string) => apiPost<SalesDoc>(`/v1/sales/invoices/${id}/issue/`, {}),
  creditNote: (id: string) => apiPost<SalesDoc>(`/v1/sales/invoices/${id}/credit-note/`, {}),
  check: (kind: SalesKind, id: string) => apiGet<CheckIssue[]>(`${base(kind)}${id}/check/`),
  emailDraft: (kind: SalesKind, id: string) => apiGet<EmailDraft>(`${base(kind)}${id}/email-draft/`),
  send: (kind: SalesKind, id: string, body: SendBody) => apiPost<SendLogEntry>(`${base(kind)}${id}/send/`, body),
  sends: (kind: SalesKind, id: string) => apiGet<SendLogEntry[]>(`${base(kind)}${id}/sends/`),
  pay: (id: string, body: { amount: string; pay_date?: string; reference?: string; method?: string }) =>
    apiPost<SalesDoc>(`/v1/sales/invoices/${id}/payments/`, body),
};

const KIND_PATH: Record<DocKind, SalesKind> = {
  quote: 'quotes',
  order: 'orders',
  invoice: 'invoices',
  credit_note: 'credit-notes',
};
export const kindPath = (k: DocKind): SalesKind => KIND_PATH[k];

/** The rendered PDF; an error answer surfaces as its message instead of a broken document. */
export async function fetchSalesPdf(kind: SalesKind, id: string): Promise<Blob> {
  const token = getAuthToken();
  const headers: Record<string, string> = { Accept: 'application/pdf' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${base(kind)}${id}/pdf/`, { method: 'GET', headers });
  if (!response.ok) {
    let detail = `PDF failed (HTTP ${response.status})`;
    try {
      detail = extractErrorMessageFromBody(await response.json()) ?? detail;
    } catch {
      // Not JSON; keep the status message.
    }
    throw new Error(detail);
  }
  return response.blob();
}

/** Client-side preview using the same per-line half-up rounding as the server. */
export function lineTotals(l: Pick<SalesLine, 'qty' | 'unit_price' | 'discount_pct' | 'tax_rate'>) {
  const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
  const net = r2((Number(l.qty) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.discount_pct) || 0) / 100));
  const tax = r2((net * (Number(l.tax_rate) || 0)) / 100);
  return { net, tax, gross: r2(net + tax) };
}

export function fmtMoney(v: string | number, currency: string) {
  const n = typeof v === 'number' ? v : Number(v);
  try {
    return fmtCurrency(n, currency);
  } catch {
    return n.toFixed(2);
  }
}

export const STATUS_VARIANT: Record<string, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  draft: 'neutral',
  sent: 'blue',
  confirmed: 'blue',
  issued: 'blue',
  accepted: 'success',
  converted: 'success',
  invoiced: 'success',
  paid: 'success',
  partially_paid: 'warning',
  delivered: 'success',
  overdue: 'error',
  expired: 'warning',
  rejected: 'error',
  cancelled: 'error',
};
