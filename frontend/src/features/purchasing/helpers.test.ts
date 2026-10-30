import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  addDays,
  buildTimeline,
  docsToCsv,
  dueTone,
  filtersFromParams,
  filtersToParams,
  initials,
  nextSort,
  paymentRun,
  sortDocs,
  toCsv,
  totalsByTaxRate,
  validateLines,
} from './helpers';
import { listQueryString, type PurchasingDocSummary } from './api';
import { moveItem } from './components/LineEditor';

const doc = (p: Partial<PurchasingDocSummary>): PurchasingDocSummary => ({
  id: 'x', number: 'PO-1', status: 'draft', supplier_id: null, supplier_name: 'Acme', currency: 'EUR',
  doc_date: '2026-01-01', due_date: null, net_total: '100', tax_total: '19', gross_total: '119', ...p,
});

describe('URL filters', () => {
  it('round-trips through search params and keeps other params', () => {
    const f = { ...EMPTY_FILTERS, status: ['draft', 'posted'], q: 'acme', overdue: true, match: 'matched', date_from: '2026-01-01', sort: 'due_date', supplier_id: 's1', supplier_name: 'Acme' };
    const p = filtersToParams(f, new URLSearchParams('tab=bills'));
    expect(p.get('tab')).toBe('bills');
    expect(p.get('status')).toBe('draft,posted');
    expect(filtersFromParams(p)).toEqual(f);
    expect(activeFilterCount(f)).toBe(6);
  });
  it('drops empty values and the default sort', () => {
    expect(filtersToParams(EMPTY_FILTERS).toString()).toBe('');
  });
  it('builds the API query string', () => {
    expect(listQueryString({ status: ['a', 'b'], overdue: true, sort: '-doc_date', limit: 50, offset: 0 })).toBe(
      '?status=a%2Cb&overdue=true&sort=-doc_date&limit=50&offset=0',
    );
  });
  it('toggles sort direction', () => {
    expect(nextSort('-doc_date', 'doc_date')).toBe('doc_date');
    expect(nextSort('doc_date', 'doc_date')).toBe('-doc_date');
    expect(nextSort('-doc_date', 'number')).toBe('number');
    expect(nextSort('number', 'gross_total')).toBe('-gross_total');
  });
});

describe('totalsByTaxRate', () => {
  it('groups per rate with discount applied before tax', () => {
    const r = totalsByTaxRate([
      { qty: '2', unit_price: '50', tax_rate: '19', discount_pct: '10' },
      { qty: '1', unit_price: '10', tax_rate: '7' },
      { qty: '1', unit_price: '10', tax_rate: '19' },
    ]);
    expect(r.buckets).toEqual([
      { rate: 19, net: 100, tax: 19 },
      { rate: 7, net: 10, tax: 0.7 },
    ]);
    expect(r.gross).toBe(129.7);
  });
});

describe('CSV', () => {
  it('quotes cells with separators and quotes', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"']])).toBe('a,b\r\n"x,y","say ""hi"""');
  });
  it('exports documents', () => {
    const csv = docsToCsv([doc({ balance_due: '19' })]);
    expect(csv.split('\r\n')[1]).toBe('PO-1,Acme,2026-01-01,,draft,EUR,100,19,119,19');
  });
});

describe('timeline', () => {
  it('order partially received and billed', () => {
    expect(buildTimeline({ kind: 'orders', status: 'partially_received', receivedPct: 40, billCount: 1 })).toEqual({
      ordered: 'done', received: 'partial', billed: 'done', paid: 'todo',
    });
  });
  it('bill paid without PO', () => {
    expect(buildTimeline({ kind: 'bills', status: 'paid', gross: 100, balanceDue: 0 })).toEqual({
      ordered: 'skipped', received: 'skipped', billed: 'done', paid: 'done',
    });
  });
  it('bill partly paid from PO', () => {
    const s = buildTimeline({ kind: 'bills', status: 'partially_paid', hasOrder: true, hasReceipt: true, gross: 100, balanceDue: 40 });
    expect(s.paid).toBe('partial');
    expect(s.received).toBe('done');
  });
});

describe('misc helpers', () => {
  it('initials', () => {
    expect(initials('Acme Steel GmbH')).toBe('AG');
    expect(initials('acme')).toBe('AC');
    expect(initials('')).toBe('?');
  });
  it('due tone', () => {
    const today = new Date(2026, 0, 10);
    expect(dueTone('2026-01-09', true, today)).toBe('overdue');
    expect(dueTone('2026-01-15', true, today)).toBe('soon');
    expect(dueTone('2026-02-15', true, today)).toBe('normal');
    expect(dueTone('2026-01-09', false, today)).toBe('normal');
  });
  it('addDays', () => expect(addDays('2026-01-30', 30)).toBe('2026-03-01'));
  it('payment run groups by currency and skips credits/paid', () => {
    const r = paymentRun([
      doc({ id: '1', balance_due: '50' }),
      doc({ id: '2', balance_due: '25.5', supplier_name: 'B' }),
      doc({ id: '3', balance_due: '0' }),
      doc({ id: '4', balance_due: '10', kind: 'credit_note' }),
      doc({ id: '5', balance_due: '7', currency: 'USD' }),
    ]);
    expect(r).toEqual([
      { currency: 'EUR', count: 2, total: 75.5, suppliers: 2 },
      { currency: 'USD', count: 1, total: 7, suppliers: 1 },
    ]);
  });
  it('sorts merged docs', () => {
    const rows = [doc({ id: 'a', gross_total: '5' }), doc({ id: 'b', gross_total: '50' })];
    expect(sortDocs(rows, '-gross_total').map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('validates lines', () => {
    expect(validateLines([{ description: '', qty: '0', unit_price: '-1', discount_pct: '120' }])[0]).toEqual({
      description: 'required', qty: 'positive', unit_price: 'invalid', discount_pct: 'range',
    });
  });
  it('moves lines', () => expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]));
});
