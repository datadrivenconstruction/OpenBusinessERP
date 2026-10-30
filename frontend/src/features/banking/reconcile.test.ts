import { describe, expect, it } from 'vitest';
import type { OpenItem, Suggestion } from './api';
import { csvSample, keyAction, mappingReady } from './logic';
import {
  addDraft,
  allocatedOf,
  candidatesFor,
  clampDrafts,
  draftDifference,
  draftProblem,
  draftsFromSuggestion,
  isBulkSafe,
  reasonInfo,
  removeDraft,
  setDraftAmount,
  writeOffResidual,
} from './reconcile';
import { accountPatch, ibanLooksValid } from './modals/AccountFormModal';
import { ledgerGap } from './components/BankingKpis';
import { patternError, ruleFromLine } from './modals/RuleFormModal';
import { groupIban } from './components/AccountCards';

const item = (id: string, open: string, kind: OpenItem['kind'] = 'sales_invoice', partner = 'Acme'): OpenItem => ({
  kind, id, number: `INV-${id}`, partner_name: partner, open_amount: open, currency: 'EUR', due_date: null,
});

describe('score explanation', () => {
  it('maps server reasons to keys and weights', () => {
    expect(reasonInfo('amount equal')).toMatchObject({ key: 'amount_equal', weight: '+40' });
    expect(reasonInfo('amount within tolerance (0.02)').key).toBe('amount_tolerance');
    expect(reasonInfo('sum of 3 open items')).toMatchObject({ key: 'sum_items', n: 3 });
    expect(reasonInfo('something new')).toEqual({ key: 'other', defaultValue: 'something new', weight: '' });
  });
});

describe('split / partial allocation drafts', () => {
  it('adds items up to what is left on the line and never twice', () => {
    let d = addDraft([], item('a', '70'), 100);
    d = addDraft(d, item('b', '50'), 100);
    expect(d.map((x) => x.amount)).toEqual(['70.00', '30.00']);
    expect(addDraft(d, item('a', '70'), 100)).toBe(d);
    expect(addDraft(d, item('c', '10'), 100)).toBe(d); // nothing left
    expect(allocatedOf(d)).toBe(100);
    expect(draftProblem(d, 100)).toBeNull();
  });

  it('validates and clamps edited amounts', () => {
    const d = addDraft([], item('a', '70'), 100);
    expect(draftProblem([], 100)).toBe('empty');
    expect(draftProblem(setDraftAmount(d, 'a', '0'), 100)).toBe('zero');
    expect(draftProblem(setDraftAmount(d, 'a', '80'), 100)).toBe('over_item');
    expect(clampDrafts(setDraftAmount(d, 'a', '80,5'))[0]?.amount).toBe('70.00');
    const partial = setDraftAmount(d, 'a', '40');
    expect(draftDifference(partial, 100)).toBe(60);
    expect(writeOffResidual(setDraftAmount(d, 'a', '68.50'), 5)).toBe(1.5);
    expect(writeOffResidual(partial, 5)).toBe(0);
    expect(removeDraft(d, 'a')).toEqual([]);
  });

  it('seeds drafts from a suggestion and filters candidates by direction', () => {
    const s: Suggestion = { score: 0.9, reasons: [], difference: '0', is_split: false, allocations: [{ kind: 'sales_invoice', id: 'a', number: 'INV-a', amount: '70.00' }] };
    expect(draftsFromSuggestion(s, [item('a', '70')])[0]).toMatchObject({ open: 70, partner_name: 'Acme' });
    const items = [item('a', '500'), item('b', '99'), item('c', '100', 'purchase_bill'), item('d', '101', 'sales_invoice', 'Beta')];
    expect(candidatesFor({ amount: '100', matched_amount: '0' }, items, '').map((i) => i.id)).toEqual(['b', 'd', 'a']);
    expect(candidatesFor({ amount: '-100', matched_amount: '0' }, items, '').map((i) => i.id)).toEqual(['c']);
    expect(candidatesFor({ amount: '100', matched_amount: '0' }, items, 'beta', ['b']).map((i) => i.id)).toEqual(['d']);
  });

  it('bulk accept only takes exact, unambiguous high scores', () => {
    const top: Suggestion = { score: 0.95, reasons: [], difference: '0', is_split: false, allocations: [] };
    expect(isBulkSafe([top], 0.85)).toBe(true);
    expect(isBulkSafe([top, { ...top, score: 0.93 }], 0.85)).toBe(false);
    expect(isBulkSafe([{ ...top, difference: '1.00' }], 0.85)).toBe(false);
    expect(isBulkSafe([{ ...top, score: 0.8 }], 0.85)).toBe(false);
    expect(isBulkSafe([], 0.85)).toBe(false);
  });
});

describe('keyboard, csv and form helpers', () => {
  it('maps U to undo', () => {
    expect(keyAction('u', 0, 1)).toEqual({ type: 'undo' });
  });

  it('reads quoted CSV sample rows and checks the mapping', () => {
    const txt = 'date;amount;memo\n01.03.2026;"1.190,00";"Rechnung ""INV-1"";x"\n\n02.03.2026;-45,90;fee';
    expect(csvSample(txt, ';')).toEqual([['01.03.2026', '1.190,00', 'Rechnung "INV-1";x'], ['02.03.2026', '-45,90', 'fee']]);
    expect(mappingReady({ date: 'date' })).toBe(false);
    expect(mappingReady({ date: 'date', debit: 'd' })).toBe(true);
  });

  it('account form sends only changed fields and checks the IBAN shape', () => {
    const base = { name: 'Main', iban: 'DE89', bic: '', currency: 'EUR', gl_account_code: '1200', active: true, opening_balance: '0', opening_balance_date: '' };
    expect(accountPatch({ ...base, name: 'Ops ', active: false }, base)).toEqual({ name: 'Ops', active: false });
    expect(accountPatch({ ...base, opening_balance: '1500.25', opening_balance_date: '2026-01-01' }, base))
      .toEqual({ opening_balance: '1500.25', opening_balance_date: '2026-01-01' });
    expect(ledgerGap({ gl_difference: '-120.50' })).toBe(-120.5);
    expect(ledgerGap({ gl_difference: '0.00' })).toBeNull();
    expect(ledgerGap({ gl_difference: null })).toBeNull();
    expect(ibanLooksValid('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(ibanLooksValid('')).toBe(true);
    expect(ibanLooksValid('12345')).toBe(false);
    expect(groupIban('DE89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00');
  });

  it('rules: pattern check and prefill from a line', () => {
    expect(patternError('/[x/')).toBe(true);
    expect(patternError('/fee\\s+\\d+/')).toBe(false);
    expect(patternError(' ')).toBe(true);
    expect(ruleFromLine({ counterparty_name: 'Stadtwerke', remittance: 'Strom', amount: '-80' })).toMatchObject({
      match_field: 'counterparty', pattern: 'Stadtwerke', direction: 'out',
    });
    expect(ruleFromLine({ counterparty_name: '', remittance: 'Kontoführung Gebühr März 2026', amount: '-5' })).toMatchObject({
      match_field: 'text', pattern: 'Kontoführung Gebühr März',
    });
  });
});
