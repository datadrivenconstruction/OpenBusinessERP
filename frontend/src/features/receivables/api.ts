/** API helpers for receivables aging and dunning (/api/v1/receivables/). */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut, downloadWithAuth } from '@/shared/lib/api';

export const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export type Bucket = (typeof BUCKETS)[number];

export interface AgingInvoice {
  id: string;
  number: string;
  doc_date: string;
  due_date: string | null;
  open: string;
  currency: string;
  /** Open amount in base currency at the invoice rate. */
  open_base?: string;
  fx_rate?: string;
  days_overdue: number;
  bucket: Bucket;
}

export type AgingRow = Record<Bucket, string> & {
  partner_key: string;
  customer_id: string | null;
  customer_name: string;
  total: string;
  invoices: AgingInvoice[];
};

export interface Aging {
  as_of: string;
  base_currency?: string;
  rows: AgingRow[];
  totals: Record<Bucket | 'total', string>;
}

export interface DunningLevel {
  level: number;
  name: string;
  days_after_due: number;
  fee: string;
  subject: string;
  body: string;
}

export interface DunningLetter {
  id: string;
  run_id: string;
  invoice_id: string;
  invoice_number: string;
  partner_key: string;
  customer_name: string;
  level: number;
  letter_date: string;
  days_overdue: number;
  currency: string;
  outstanding: string;
  fee: string;
  interest: string;
  channel: 'letter' | 'email';
  subject: string;
  body: string;
  status: 'draft' | 'approved' | 'discarded' | 'sent';
  decided_at: string | null;
  sent_at?: string | null;
  sent_to?: string;
}

export interface DunningRun {
  id: string;
  run_date: string;
  letters: DunningLetter[];
}

export interface DunningBlock {
  id: string;
  partner_key: string;
  customer_name: string;
  reason: string;
}

export interface DunningSettings {
  fees_enabled: boolean;
  interest_enabled: boolean;
  interest_rate_pct: string;
  min_days_between: number;
  interest_rate_hint?: string;
}

export type DunningPreview = Omit<DunningLetter, 'id' | 'run_id' | 'channel' | 'status' | 'decided_at'>;

export type PromiseStatus = 'open' | 'kept' | 'broken' | 'cancelled';

export interface FollowUp {
  id: string;
  partner_key: string;
  customer_name: string;
  kind: 'note' | 'promise';
  text: string;
  invoice_id: string | null;
  invoice_number: string;
  promised_date: string | null;
  promised_amount: string | null;
  status: PromiseStatus | '';
  overdue: boolean;
  created_at: string;
  created_by: string | null;
}

export interface FollowUpInput {
  partner_key: string;
  customer_name?: string;
  kind: 'note' | 'promise';
  text?: string;
  invoice_id?: string | null;
  promised_date?: string | null;
  promised_amount?: string | null;
}

export interface CustomerPayment {
  id: string;
  invoice_id: string;
  invoice_number: string;
  pay_date: string;
  amount: string;
  currency: string;
  method: string;
  reference: string;
  days_to_pay: number;
  days_late: number;
}

export interface CustomerDetail {
  partner_key: string;
  customer_name: string;
  as_of: string;
  blocked: boolean;
  open_total: string;
  overdue_total: string;
  buckets: Record<Bucket, string>;
  invoices: AgingInvoice[];
  payments: CustomerPayment[];
  stats: { avg_days_to_pay: number | null; avg_days_late: number | null; on_time_share: number | null; paid_total: string };
  letters: DunningLetter[];
  followups: FollowUp[];
  promised_open: string;
  next_dunning: DunningPreview[];
}

const R = '/v1/receivables';
const q = (params: Record<string, string | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
};

export const receivablesApi = {
  aging: (asOf?: string) => apiGet<Aging>(`${R}/aging/${asOf ? `?as_of=${asOf}` : ''}`),
  statement: (partnerKey: string) =>
    downloadWithAuth(`/api${R}/statement/?partner_key=${encodeURIComponent(partnerKey)}`, 'statement.pdf'),
  levels: () => apiGet<DunningLevel[]>(`${R}/levels/`),
  saveLevels: (levels: DunningLevel[]) => apiPut<DunningLevel[]>(`${R}/levels/`, levels),
  settings: () => apiGet<DunningSettings>(`${R}/settings/`),
  saveSettings: (s: Partial<DunningSettings>) => apiPut<DunningSettings>(`${R}/settings/`, s),
  blocks: () => apiGet<DunningBlock[]>(`${R}/blocks/`),
  block: (partner_key: string, customer_name: string, reason = '') =>
    apiPost<DunningBlock>(`${R}/blocks/`, { partner_key, customer_name, reason }),
  unblock: (id: string) => apiDelete(`${R}/blocks/${id}/`),
  runs: () => apiGet<DunningRun[]>(`${R}/runs/`),
  createRun: (as_of?: string) => apiPost<DunningRun>(`${R}/runs/`, { as_of: as_of || null }),
  updateLetter: (id: string, body: Partial<Pick<DunningLetter, 'subject' | 'body' | 'channel'>>) =>
    apiPatch<DunningLetter>(`${R}/letters/${id}/`, body),
  decide: (id: string, decision: 'approved' | 'discarded') =>
    apiPost<DunningLetter>(`${R}/letters/${id}/decision/`, { decision }),
  sendLetter: (id: string, body: { to?: string; cc?: string[] } = {}) =>
    apiPost<{ letter: DunningLetter; ok: boolean; reason: string }>(`${R}/letters/${id}/send/`, body),
  preview: (asOf?: string) => apiGet<DunningPreview[]>(`${R}/runs/preview/${q({ as_of: asOf })}`),
  customer: (partnerKey: string, asOf?: string) =>
    apiGet<CustomerDetail>(`${R}/customer/${q({ partner_key: partnerKey, as_of: asOf })}`),
  promises: (status: PromiseStatus | '' = 'open') =>
    apiGet<FollowUp[]>(`${R}/followups/?status_filter=${status}`),
  addFollowUp: (body: FollowUpInput) => apiPost<FollowUp>(`${R}/followups/`, body),
  setPromiseStatus: (id: string, status: PromiseStatus) => apiPatch<FollowUp>(`${R}/followups/${id}/`, { status }),
  deleteFollowUp: (id: string) => apiDelete(`${R}/followups/${id}/`),
  history: (partnerKey?: string) =>
    apiGet<DunningLetter[]>(`${R}/history/${partnerKey ? `?partner_key=${encodeURIComponent(partnerKey)}` : ''}`),
};

/** Share of the total that is past due, 0–100. */
export function overdueShare(row: Pick<AgingRow, Bucket | 'total'>): number {
  const total = Number(row.total);
  if (!total) return 0;
  return Math.round(((total - Number(row.current)) / total) * 100);
}

/** mailto: link that opens the user's own mail program with the draft; nothing is sent by the app. */
export function mailtoDraft(letter: Pick<DunningLetter, 'subject' | 'body'>, to = ''): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.body)}`;
}

/** A single aging bucket, or every past-due bucket at once. */
export type BucketFilter = Bucket | 'overdue';

/** Rows with a balance in the chosen bucket (or anything past due); all rows when nothing is chosen. */
export function filterByBucket<T extends Pick<AgingRow, Bucket | 'total'>>(rows: T[], bucket: BucketFilter | null): T[] {
  if (!bucket) return rows;
  if (bucket === 'overdue') return rows.filter((r) => Number(r.total) - Number(r.current) > 0);
  return rows.filter((r) => Number(r[bucket]) !== 0);
}

/** Bucket shares of the grand total in percent (rounded), for the aging bar. */
export function bucketShares(totals: Record<Bucket | 'total', string>): Record<Bucket, number> {
  const total = Number(totals.total) || 0;
  return Object.fromEntries(
    BUCKETS.map((b) => [b, total ? Math.round((Number(totals[b]) / total) * 1000) / 10 : 0]),
  ) as Record<Bucket, number>;
}

/** Per-level count of drafts a run would create. */
export function previewByLevel(preview: Pick<DunningPreview, 'level'>[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of preview) m.set(p.level, (m.get(p.level) ?? 0) + 1);
  return m;
}
