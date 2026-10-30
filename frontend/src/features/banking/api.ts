/** API helpers for bank accounts, statement import and reconciliation (/api/v1/banking/). */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut, extractErrorMessageFromBody, fetchWithAuth } from '@/shared/lib/api';

export type LineStatus = 'unmatched' | 'partially_matched' | 'matched' | 'ignored';
export type StatementFormat = 'camt053' | 'camt054' | 'mt940' | 'csv';

export interface BankAccount {
  id: string;
  name: string;
  iban: string;
  bic: string;
  currency: string;
  gl_account_code: string;
  active: boolean;
  opening_balance: string;
  opening_balance_date: string | null;
}

export interface BankMatch {
  id: string;
  target_type: 'sales_invoice' | 'purchase_bill' | 'gl_entry' | 'write_off';
  target_id: string | null;
  target_number: string;
  amount: string;
  gl_entry_id: string | null;
}

export interface BankTransaction {
  id: string;
  account_id: string;
  booking_date: string;
  value_date: string | null;
  amount: string;
  currency: string;
  counterparty_name: string;
  counterparty_iban: string;
  remittance: string;
  reference: string;
  status: LineStatus;
  matched_amount: string;
  matches: BankMatch[];
}

export interface Allocation {
  kind: 'sales_invoice' | 'purchase_bill';
  id: string;
  number: string;
  amount: string;
}

export interface Suggestion {
  score: number;
  allocations: Allocation[];
  reasons: string[];
  difference: string;
  is_split: boolean;
}

export interface OpenItem {
  kind: 'sales_invoice' | 'purchase_bill';
  id: string;
  number: string;
  partner_name: string;
  open_amount: string;
  currency: string;
  due_date: string | null;
}

export interface StatementResult {
  id: string;
  filename: string;
  format: string;
  imported_count: number;
  duplicate_count: number;
}

export interface BankSettings {
  amount_tolerance: string | null;
  date_window_days: number | null;
  writeoff_account_code: string | null;
  writeoff_max: string | null;
}

export interface AccountSummary {
  account_id: string;
  name: string;
  iban: string;
  currency: string;
  active: boolean;
  /** Opening balance + sum of imported statement lines. */
  balance: string;
  opening_balance: string;
  opening_balance_date: string | null;
  gl_account_code: string;
  gl_balance: string | null;
  /** balance - gl_balance; null when the account has no GL mapping. */
  gl_difference: string | null;
  line_count: number;
  unmatched_count: number;
  last_booking_date: string | null;
}

export interface BankingSummary {
  accounts: AccountSummary[];
  unmatched_count: number;
  unmatched_amount: string;
  matched_this_month: number;
  matched_amount_this_month: string;
  document_matches_this_month: number;
  active_rules: number;
}

export type PreviewState = 'new' | 'duplicate' | 'duplicate_in_file';

export interface PreviewRow {
  booking_date: string;
  amount: string;
  currency: string;
  counterparty_name: string;
  remittance: string;
  reference: string;
  state: PreviewState;
  rule_name: string | null;
}

export interface ImportPreview {
  format: string;
  total: number;
  new_count: number;
  duplicate_count: number;
  duplicate_in_file_count: number;
  date_from: string | null;
  date_to: string | null;
  total_in: string;
  total_out: string;
  currency_mismatch: boolean;
  currencies: string[];
  rows: PreviewRow[];
}

export interface BulkAcceptResult {
  accepted: string[];
  skipped: number;
  errors: string[];
}

export type RuleField = 'counterparty' | 'text' | 'iban' | 'any';
export type RuleDirection = 'in' | 'out' | 'any';

export interface BankRuleInput {
  name: string;
  match_field: RuleField;
  pattern: string;
  direction: RuleDirection;
  min_amount: string | null;
  max_amount: string | null;
  account_code: string;
  memo: string;
  priority: number;
  active: boolean;
}

export interface BankRule extends BankRuleInput {
  id: string;
  hit_count: number;
}

export interface RuleHit {
  transaction_id: string;
  rule_id: string;
  rule_name: string;
  account_code: string;
  amount: string;
}

export interface ApplyRulesResult {
  applied: number;
  hits: RuleHit[];
  errors: string[];
}

/** Column mapping for CSV statements; values are header names. */
export interface CsvMapping {
  date: string;
  amount?: string;
  debit?: string;
  credit?: string;
  value_date?: string;
  currency?: string;
  counterparty_name?: string;
  counterparty_iban?: string;
  remittance?: string;
  reference?: string;
  delimiter?: string;
  decimal?: ',' | '.';
  date_format?: string;
}

const B = '/v1/banking';

export const bankingApi = {
  accounts: () => apiGet<BankAccount[]>(`${B}/accounts/`),
  createAccount: (body: Partial<BankAccount> & { name: string }) => apiPost<BankAccount>(`${B}/accounts/`, body),
  updateAccount: (id: string, body: Partial<BankAccount>) => apiPatch<BankAccount>(`${B}/accounts/${id}/`, body),
  transactions: (accountId?: string, status?: string) => {
    const q = new URLSearchParams();
    if (accountId) q.set('account_id', accountId);
    if (status) q.set('status_filter', status);
    const qs = q.toString();
    return apiGet<BankTransaction[]>(`${B}/transactions/${qs ? `?${qs}` : ''}`);
  },
  suggestions: (id: string) => apiGet<Suggestion[]>(`${B}/transactions/${id}/suggestions/`),
  confirm: (id: string, allocations: Allocation[], writeOff: boolean, confidence?: number) =>
    apiPost<BankTransaction>(`${B}/transactions/${id}/confirm/`, {
      allocations: allocations.map((a) => ({ target_type: a.kind, target_id: a.id, amount: a.amount })),
      write_off_difference: writeOff,
      confidence,
    }),
  manualEntry: (id: string, account_code: string, memo: string, amount?: string) =>
    apiPost<BankTransaction>(`${B}/transactions/${id}/manual-entry/`, { account_code, memo, amount: amount || null }),
  undo: (id: string) => apiPost<BankTransaction>(`${B}/transactions/${id}/undo/`, {}),
  ignore: (id: string, ignored: boolean) => apiPost<BankTransaction>(`${B}/transactions/${id}/ignore/`, { ignored }),
  openItems: () => apiGet<OpenItem[]>(`${B}/open-items/`),
  settings: () => apiGet<BankSettings>(`${B}/settings/`),
  saveSettings: (body: BankSettings) => apiPut<BankSettings>(`${B}/settings/`, body),
  summary: () => apiGet<BankingSummary>(`${B}/summary/`),
  bulkAccept: (minScore: number, accountId?: string) =>
    apiPost<BulkAcceptResult>(`${B}/transactions/bulk-accept/`, { min_score: minScore, account_id: accountId || null }),
  ruleFor: (id: string) => apiGet<BankRule | null>(`${B}/transactions/${id}/rule/`),
  rules: () => apiGet<BankRule[]>(`${B}/rules/`),
  createRule: (body: BankRuleInput) => apiPost<BankRule>(`${B}/rules/`, body),
  updateRule: (id: string, body: Partial<BankRuleInput>) => apiPatch<BankRule>(`${B}/rules/${id}/`, body),
  deleteRule: (id: string) => apiDelete(`${B}/rules/${id}/`),
  applyRules: (dryRun: boolean, accountId?: string) =>
    apiPost<ApplyRulesResult>(`${B}/rules/apply/`, { dry_run: dryRun, account_id: accountId || null }),
  importStatement: (accountId: string, file: File, format?: StatementFormat, mapping?: CsvMapping) =>
    upload<StatementResult>(`${B}/accounts/${accountId}/import/`, file, format, mapping),
  previewImport: (accountId: string, file: File, format?: StatementFormat, mapping?: CsvMapping) =>
    upload<ImportPreview>(`${B}/accounts/${accountId}/preview/`, file, format, mapping),
};

async function upload<T>(path: string, file: File, format?: StatementFormat, mapping?: CsvMapping): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  if (format) form.append('fmt', format);
  if (mapping) form.append('mapping', JSON.stringify(cleanMapping(mapping)));
  const res = await fetchWithAuth(`/api${path}`, { method: 'POST', body: form });
  const body = await res.json().catch(() => ({ detail: res.statusText }));
  if (!res.ok) throw new Error(extractErrorMessageFromBody(body) ?? 'Import failed');
  return body as T;
}

/** Drop empty fields so the server sees only the columns the user picked. */
export function cleanMapping(m: CsvMapping): Partial<CsvMapping> {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined && v !== '')) as Partial<CsvMapping>;
}
