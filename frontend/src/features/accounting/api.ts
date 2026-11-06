/** API helpers for the Accounting screens, backed by /api/v1/gl/. */

import { useQuery } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, downloadWithAuth, extractErrorMessageFromBody, fetchWithAuth } from '@/shared/lib/api';

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];

export interface Account {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  parent_id: string | null;
  currency: string | null;
  is_postable: boolean;
  active: boolean;
  template: string | null;
}

export interface AccountInput {
  code?: string;
  name: string;
  account_type: AccountType;
  parent_id: string | null;
  is_postable: boolean;
  active: boolean;
}

export interface Period {
  id: string;
  fiscal_year_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
}

export interface FiscalYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  periods: Period[];
}

export interface EntryLine {
  id?: string;
  line_no?: number;
  account_id: string;
  description: string;
  debit: string;
  credit: string;
}

export interface Entry {
  id: string;
  number: string | null;
  entry_date: string;
  currency: string;
  base_currency: string;
  status: 'draft' | 'posted' | 'reversed' | string;
  source_type: string | null;
  source_id: string | null;
  memo: string;
  reversal_of_id: string | null;
  reversed_by_id: string | null;
  lines: EntryLine[];
}

export interface EntryInput {
  entry_date: string;
  memo: string;
  lines: { account_id: string; debit: string; credit: string; description: string }[];
}

export interface EntryFilters {
  status?: string;
  date_from?: string;
  date_to?: string;
  source_type?: string;
}

export interface TrialRow {
  account_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
}
export interface TrialBalance {
  base_currency: string;
  rows: TrialRow[];
  total_debit: string;
  total_credit: string;
  balanced: boolean;
}

export interface Section {
  accounts: { account_id: string; code: string; name: string; balance: string }[];
  total: string;
}
export interface ProfitLoss {
  base_currency: string;
  income: Section;
  expense: Section;
  net_income: string;
}
export interface BalanceSheet {
  base_currency: string;
  as_of: string;
  asset: Section;
  liability: Section;
  equity: Section;
  unclosed_earnings: string;
  total_assets: string;
  total_liabilities_equity: string;
  balanced: boolean;
}
export interface Ledger {
  account_id: string;
  code: string;
  name: string;
  base_currency: string;
  opening: string;
  closing: string;
  rows: {
    entry_id: string;
    number: string | null;
    entry_date: string;
    memo: string;
    description: string;
    debit: string;
    credit: string;
    balance: string;
  }[];
}

const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export interface VatAccount { account_id: string; code: string; name: string; debit: string; credit: string }
export interface VatReport {
  base_currency: string;
  date_from: string | null;
  date_to: string | null;
  output_accounts: VatAccount[];
  input_accounts: VatAccount[];
  output_vat: string;
  input_vat: string;
  net_payable: string;
}
export interface GlKpis {
  base_currency: string;
  as_of: string;
  revenue_ytd: string;
  net_income_ytd: string;
  net_income_mtd: string;
  total_assets: string;
  balanced: boolean;
  draft_entries: number;
}

export interface GlAttachment { id: string; entry_id: string; filename: string; content_type: string; size: number; uploaded_by: string | null; created_at: string }

async function uploadAttachment(entryId: string, file: File): Promise<GlAttachment> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetchWithAuth(`/api/v1/gl/entries/${entryId}/attachments/`, { method: 'POST', body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(extractErrorMessageFromBody(body) ?? res.statusText);
  return body as GlAttachment;
}

export interface FxRevalRow {
  side: 'receivable' | 'payable';
  id: string;
  number: string;
  party: string;
  currency: string;
  open: string;
  doc_rate: string;
  closing_rate: string;
  booked: string;
  revalued: string;
  gain: string;
}
export interface FxRevalResult {
  period_end: string;
  reversal_date: string;
  base_currency: string;
  rates: Record<string, string>;
  rows: FxRevalRow[];
  receivable_diff: string;
  payable_diff: string;
  net_gain: string;
  posted: boolean;
  entry_id?: string | null;
  reversal_id?: string | null;
}
export interface FxRevalBody { period_end: string; rates?: Record<string, string> }

export const glApi = {
  fxRevalPreview: (b: FxRevalBody) => apiPost<FxRevalResult>('/v1/gl/fx-revaluation/preview/', b),
  fxRevalPost: (b: FxRevalBody) => apiPost<FxRevalResult>('/v1/gl/fx-revaluation/', b),
  attachments: (entryId: string) => apiGet<GlAttachment[]>(`/v1/gl/entries/${entryId}/attachments/`),
  uploadAttachment,
  downloadAttachment: (a: GlAttachment) => downloadWithAuth(`/api/v1/gl/attachments/${a.id}/download/`, a.filename),
  deleteAttachment: (id: string) => apiDelete(`/v1/gl/attachments/${id}/`),
  vatReport: (from: string, to: string) => apiGet<VatReport>(`/v1/gl/reports/vat/${qs({ date_from: from, date_to: to })}`),
  kpis: () => apiGet<GlKpis>('/v1/gl/kpis/'),
  accounts: () => apiGet<Account[]>('/v1/gl/accounts/'),
  createAccount: (b: AccountInput) => apiPost<Account>('/v1/gl/accounts/', b),
  updateAccount: (id: string, b: Omit<AccountInput, 'code'>) => apiPatch<Account>(`/v1/gl/accounts/${id}/`, b),
  fiscalYears: () => apiGet<FiscalYear[]>('/v1/gl/fiscal-years/'),
  entries: (f: EntryFilters) => apiGet<Entry[]>(`/v1/gl/entries/${qs({ ...f, limit: '500' })}`),
  entry: (id: string) => apiGet<Entry>(`/v1/gl/entries/${id}/`),
  createEntry: (b: EntryInput) => apiPost<Entry>('/v1/gl/entries/', b),
  deleteEntry: (id: string) => apiDelete(`/v1/gl/entries/${id}/`),
  post: (id: string) => apiPost<Entry>(`/v1/gl/entries/${id}/post/`, {}),
  reverse: (id: string, on?: string) => apiPost<Entry>(`/v1/gl/entries/${id}/reverse/`, on ? { on } : {}),
  trialBalance: (from?: string, to?: string) =>
    apiGet<TrialBalance>(`/v1/gl/reports/trial-balance/${qs({ date_from: from, date_to: to })}`),
  profitLoss: (from?: string, to?: string) =>
    apiGet<ProfitLoss>(`/v1/gl/reports/profit-loss/${qs({ date_from: from, date_to: to })}`),
  balanceSheet: (asOf: string) => apiGet<BalanceSheet>(`/v1/gl/reports/balance-sheet/${qs({ as_of: asOf })}`),
  ledger: (id: string, from?: string, to?: string) =>
    apiGet<Ledger>(`/v1/gl/reports/ledger/${id}/${qs({ date_from: from, date_to: to })}`),
};

/** Same query key as the sales feature, so the settings are fetched once. */
export function useBusinessCurrency(): string {
  const q = useQuery({
    queryKey: ['business-settings'],
    queryFn: () => apiGet<{ base_currency?: string | null; country_code?: string | null }>('/v1/business-settings/'),
    retry: false,
    staleTime: 5 * 60_000,
  });
  return q.data?.base_currency || 'EUR';
}

// ── money helpers (integer cents, so debit = credit is exact) ────────────
export const toCents = (v: string | number | undefined | null): number => Math.round((Number(v) || 0) * 100);

export interface LineDraft {
  account_id: string;
  description: string;
  debit: string;
  credit: string;
}

export function entryBalance(lines: Pick<LineDraft, 'debit' | 'credit'>[]) {
  const debit = lines.reduce((s, l) => s + toCents(l.debit), 0);
  const credit = lines.reduce((s, l) => s + toCents(l.credit), 0);
  return { debit: debit / 100, credit: credit / 100, diff: (debit - credit) / 100, balanced: debit === credit && debit > 0 };
}

/** Why a draft cannot be saved yet, or null when it can. */
export function validateEntry(lines: LineDraft[]): 'lines' | 'line' | 'balance' | null {
  const filled = lines.filter((l) => l.account_id || toCents(l.debit) || toCents(l.credit));
  if (filled.length < 2) return 'lines';
  for (const l of filled) {
    const d = toCents(l.debit);
    const c = toCents(l.credit);
    if (!l.account_id || (d > 0) === (c > 0) || d < 0 || c < 0) return 'line';
  }
  return entryBalance(filled).balanced ? null : 'balance';
}

// ── dates ────────────────────────────────────────────────────────────────
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type RangePreset = 'month' | 'last_month' | 'quarter' | 'year' | 'last_year';
export const RANGE_PRESETS: RangePreset[] = ['month', 'last_month', 'quarter', 'year', 'last_year'];

export function presetRange(p: RangePreset, now = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (p) {
    case 'month': return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'last_month': return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'quarter': { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) }; }
    case 'last_year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default: return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

/** The equally long range that ends the day before `from`. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  const pTo = new Date(a);
  pTo.setDate(pTo.getDate() - 1);
  const pFrom = new Date(pTo);
  pFrom.setDate(pFrom.getDate() - days + 1);
  return { from: iso(pFrom), to: iso(pTo) };
}

// ── CSV ──────────────────────────────────────────────────────────────────
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export const STATUS_VARIANT: Record<string, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  draft: 'neutral',
  posted: 'success',
  reversed: 'warning',
};

/** Closing balance as shown to a reader: debit-natural types as is, the rest flipped. */
export const natural = (type: AccountType, closing: string | number): number => {
  const n = Number(closing) || 0;
  return type === 'asset' || type === 'expense' ? n : -n;
};

export type ExportFormat = 'datev' | 'datev-contacts' | 'saft';
export const EXPORT_FORMATS: ExportFormat[] = ['datev', 'datev-contacts', 'saft'];

export function exportUrl(fmt: ExportFormat, from: string, to: string): string {
  return `/api/v1/gl/export/${fmt}/?date_from=${from}&date_to=${to}`;
}

export function exportFilename(fmt: ExportFormat, from: string, to: string): string {
  const stamp = `${from.replaceAll('-', '')}_${to.replaceAll('-', '')}`;
  if (fmt === 'saft') return `SAF-T_${stamp}.xml`;
  return fmt === 'datev' ? `EXTF_Buchungsstapel_${stamp}.csv` : `EXTF_Debitoren_Kreditoren_${stamp}.csv`;
}
