import { describe, expect, it } from 'vitest';
import { filtersFromParams, filtersToParams, nextSort, toListQuery, clearFilters, hasActiveFilters } from './filters';
import { addDays, balanceDue, computeTotals, isOverdue, moveItem, termsDays, validateLines } from './totals';
import { csvCell, salesDocsCsv } from './csv';
import { initials, timelineIndex } from './timeline';
import { docActions } from './docActions';
import { convertBody } from '../modals/ConvertDialog';
import { listQueryString, type SalesDocSummary } from '../api';
import { taxRateOptions } from '../taxDefaults';

describe('filters <-> URL', () => {
  it('round-trips every filter', () => {
    const p = new URLSearchParams('tab=invoices&q=acme&status=issued,partially_paid&customer=c1&customer_name=ACME&from=2026-01-01&to=2026-02-01&overdue=1&sort=gross_total&page=3');
    const f = filtersFromParams(p);
    expect(f).toMatchObject({ tab: 'invoices', q: 'acme', status: ['issued', 'partially_paid'], customer_id: 'c1', overdue: true, sort: 'gross_total', page: 3 });
    expect(filtersFromParams(filtersToParams(f))).toEqual(f);
  });
  it('defaults and drops empty values', () => {
    const f = filtersFromParams(new URLSearchParams('tab=bogus&page=-2'));
    expect(f.tab).toBe('quotes');
    expect(f.page).toBe(1);
    expect(filtersToParams(f).toString()).toBe('tab=quotes');
    expect(hasActiveFilters(f)).toBe(false);
    expect(hasActiveFilters(clearFilters({ ...f, q: 'x', overdue: true }))).toBe(false);
  });
  it('builds the API query', () => {
    const f = filtersFromParams(new URLSearchParams('tab=invoices&status=paid&overdue=1&page=2'));
    const q = toListQuery(f);
    expect(q).toMatchObject({ status: ['paid'], overdue: true, sort: '-doc_date', limit: 50, offset: 50 });
    expect(listQueryString(q)).toBe('?status=paid&overdue=true&sort=-doc_date&limit=50&offset=50');
  });
  it('flips sort direction on the active column', () => {
    expect(nextSort('-doc_date', 'doc_date')).toBe('doc_date');
    expect(nextSort('doc_date', 'doc_date')).toBe('-doc_date');
    expect(nextSort('-doc_date', 'number')).toBe('-number');
  });
});

describe('totals', () => {
  it('groups tax per rate with discounts', () => {
    const t = computeTotals([
      { qty: '2', unit_price: '100', discount_pct: '10', tax_rate: '19' },
      { qty: '1', unit_price: '50', discount_pct: '0', tax_rate: '7' },
      { qty: '1', unit_price: '20', discount_pct: '0', tax_rate: '19' },
    ]);
    expect(t.groups).toEqual([
      { rate: 19, net: 200, tax: 38 },
      { rate: 7, net: 50, tax: 3.5 },
    ]);
    expect(t).toMatchObject({ net: 250, tax: 41.5, gross: 291.5, discount: 20 });
  });
  it('derives due date, balance and overdue', () => {
    expect(termsDays('Net 30')).toBe(30);
    expect(termsDays('')).toBeNull();
    expect(addDays('2026-01-31', 30)).toBe('2026-03-02');
    expect(balanceDue({ gross_total: '100', amount_paid: '40' })).toBe(60);
    expect(balanceDue({ balance_due: '12.5', gross_total: '100', amount_paid: '0' })).toBe(12.5);
    const inv = { kind: 'invoice', status: 'issued', due_date: '2026-01-01' };
    expect(isOverdue(inv, '2026-02-01')).toBe(true);
    expect(isOverdue({ ...inv, status: 'paid' }, '2026-02-01')).toBe(false);
    expect(isOverdue({ ...inv, is_overdue: false }, '2026-02-01')).toBe(false);
  });
  it('validates lines and reorders', () => {
    const errs = validateLines([{ sku: '', description: '', qty: '0', unit_price: '5', discount_pct: '120' }]);
    expect(errs.map((e) => e.field)).toEqual(['description', 'qty', 'discount_pct']);
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });
  it('offers country and in-use tax rates', () => {
    expect(taxRateOptions(8.1, ['16'])).toEqual([0, 5, 7, 8.1, 10, 16, 19, 20]);
  });
});

describe('csv', () => {
  it('quotes risky cells and exports balance', () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    const csv = salesDocsCsv([
      { number: 'INV-1', doc_date: '2026-01-01', due_date: null, customer_name: 'Müller; GmbH', status: 'issued', currency: 'EUR', net_total: '100', tax_total: '19', gross_total: '119', amount_paid: '19' } as SalesDocSummary,
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('balance_due');
    expect(lines[1]).toBe('INV-1,2026-01-01,,"Müller; GmbH",issued,EUR,100,19,119,19,100.00');
  });
});

describe('timeline and actions', () => {
  it('places documents on the quote-to-cash path', () => {
    expect(timelineIndex('quote', 'draft')).toBe(0);
    expect(timelineIndex('quote', 'converted')).toBe(1);
    expect(timelineIndex('order', 'delivered')).toBe(2);
    expect(timelineIndex('invoice', 'issued')).toBe(3);
    expect(timelineIndex('invoice', 'paid')).toBe(4);
    expect(timelineIndex('quote', 'rejected')).toBe(-1);
    expect(initials('Acme Build GmbH')).toBe('AG');
    expect(initials('')).toBe('?');
  });
  it('lists workflow actions', () => {
    expect(docActions('quote', 'sent').map((a) => a.key)).toEqual(['accept', 'reject', 'to_order', 'cancel']);
    expect(docActions('invoice', 'draft').find((a) => a.primary)?.key).toBe('issue');
  });
  it('sends partial quantities only when needed', () => {
    expect(convertBody([{ line_id: 'a', max: 2, qty: '2' }])).toEqual({});
    expect(convertBody([{ line_id: 'a', max: 2, qty: '1' }, { line_id: 'b', max: 1, qty: '0' }])).toEqual({ lines: [{ line_id: 'a', qty: '1' }] });
  });
});
