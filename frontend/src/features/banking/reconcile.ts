/** Pure helpers for the two-pane workspace: score explanations and split/partial allocation drafts. */

import type { Allocation, BankTransaction, OpenItem, Suggestion } from './api';
import { fmtNumberForInput } from '@/shared/lib/formatters';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ReasonInfo {
  key: string;
  defaultValue: string;
  /** Points the signal adds to the score, as shown to the user ('' when it varies). */
  weight: string;
  n?: number;
}

// Mirrors the signal weights in backend/app/modules/banking/matching.py.
const REASONS: Array<[RegExp, string, string, string]> = [
  [/^amount equal$/, 'amount_equal', 'Amount matches exactly', '+40'],
  [/^amount within tolerance/, 'amount_tolerance', 'Amount within tolerance', '+30'],
  [/^partial payment$/, 'partial', 'Pays part of the open amount', '+10'],
  [/^document number in remittance$/, 'doc_number', 'Document number in the payment text', '+35'],
  [/^number digits in remittance$/, 'doc_digits', 'Number digits in the payment text', '+20'],
  [/^numbers in remittance$/, 'numbers', 'Document numbers in the payment text', '+35'],
  [/^partner name$/, 'partner', 'Counterparty name matches the partner', '+15'],
  [/^known IBAN$/, 'iban', 'IBAN already used by this partner', '+20'],
  [/^currency differs$/, 'currency', 'Currency differs, score halved', '×0.5'],
  [/^sum of (\d+) open items$/, 'sum_items', 'Adds up {{n}} open items', '+40'],
];

export function reasonInfo(reason: string): ReasonInfo {
  for (const [re, key, defaultValue, weight] of REASONS) {
    const m = re.exec(reason);
    if (m) return { key, defaultValue, weight, n: m[1] ? Number(m[1]) : undefined };
  }
  return { key: 'other', defaultValue: reason, weight: '' };
}

/** An allocation the user is building; `open` caps how much the item can take. */
export interface DraftAlloc extends Allocation {
  open: number;
  partner_name?: string;
}

export function allocatedOf(drafts: Pick<Allocation, 'amount'>[]): number {
  return round2(drafts.reduce((s, a) => s + (Number(a.amount) || 0), 0));
}

/** Add an open item, giving it what is still unallocated on the line (never more than it owes). */
export function addDraft(drafts: DraftAlloc[], item: OpenItem, lineOpen: number): DraftAlloc[] {
  if (drafts.some((d) => d.id === item.id)) return drafts;
  const open = Number(item.open_amount);
  const left = round2(lineOpen - allocatedOf(drafts));
  if (left <= 0) return drafts;
  const amount = round2(Math.min(open, left));
  return [
    ...drafts,
    { kind: item.kind, id: item.id, number: item.number, amount: amount.toFixed(2), open, partner_name: item.partner_name },
  ];
}

/** Edit one allocation amount; keeps the raw text so typing "12." is not fought, clamps on blur via clampDrafts. */
export function setDraftAmount(drafts: DraftAlloc[], id: string, value: string): DraftAlloc[] {
  return drafts.map((d) => (d.id === id ? { ...d, amount: value.replace(',', '.') } : d));
}

export function clampDrafts(drafts: DraftAlloc[]): DraftAlloc[] {
  return drafts.map((d) => {
    const n = Number(d.amount);
    const v = Number.isFinite(n) ? Math.min(Math.max(n, 0), d.open) : 0;
    return { ...d, amount: fmtNumberForInput(round2(v)) };
  });
}

export function removeDraft(drafts: DraftAlloc[], id: string): DraftAlloc[] {
  return drafts.filter((d) => d.id !== id);
}

export type DraftProblem = 'empty' | 'zero' | 'over_item' | 'over_line' | null;

export function draftProblem(drafts: DraftAlloc[], lineOpen: number): DraftProblem {
  if (drafts.length === 0) return 'empty';
  if (drafts.some((d) => !(Number(d.amount) > 0))) return 'zero';
  if (drafts.some((d) => Number(d.amount) > d.open + 0.001)) return 'over_item';
  if (allocatedOf(drafts) > lineOpen + 0.001) return 'over_line';
  return null;
}

/** Positive: line has money left over; the confirm then leaves the line partially matched (or writes off). */
export function draftDifference(drafts: DraftAlloc[], lineOpen: number): number {
  return round2(lineOpen - allocatedOf(drafts));
}

export function draftsFromSuggestion(s: Suggestion, items: OpenItem[]): DraftAlloc[] {
  return s.allocations.map((a) => {
    const item = items.find((i) => i.id === a.id);
    return { ...a, open: item ? Number(item.open_amount) : Number(a.amount), partner_name: item?.partner_name };
  });
}

/**
 * Open items that can take this line: invoices for money in, bills for money out,
 * filtered by text and sorted so the closest amount comes first.
 */
export function candidatesFor(
  line: Pick<BankTransaction, 'amount' | 'matched_amount'>,
  items: OpenItem[],
  query: string,
  exclude: string[] = [],
): OpenItem[] {
  const kind = Number(line.amount) > 0 ? 'sales_invoice' : 'purchase_bill';
  const open = Math.abs(Number(line.amount)) - Number(line.matched_amount);
  const q = query.trim().toLowerCase();
  return items
    .filter((i) => i.kind === kind && !exclude.includes(i.id))
    .filter((i) => !q || i.number.toLowerCase().includes(q) || i.partner_name.toLowerCase().includes(q))
    .sort((a, b) => Math.abs(Number(a.open_amount) - open) - Math.abs(Number(b.open_amount) - open));
}

/** Suggestions the bulk action would take: high score, exact close, no close runner-up. Mirrors the server rule. */
export function isBulkSafe(sugg: Suggestion[], minScore: number): boolean {
  const [top, next] = sugg;
  if (!top || top.score < minScore || Number(top.difference) !== 0) return false;
  return !next || top.score - next.score >= 0.05;
}

/** Item residuals (open minus allocated) small enough for the write-off; the server books each one. */
export function writeOffResidual(drafts: DraftAlloc[], max: number): number {
  return round2(
    drafts.reduce((s, d) => {
      const r = round2(d.open - (Number(d.amount) || 0));
      return r > 0 && r <= max ? s + r : s;
    }, 0),
  );
}
