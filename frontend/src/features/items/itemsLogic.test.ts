import { describe, expect, it } from 'vitest';
import { EMPTY_ITEM, type Item } from './api';
import {
  activeFilterCount, buildCategoryTree, initials, isDirty, itemsToCsv, marginTone, nextSort, normaliseItem,
  priceForMargin, readListState, stockLevel, toFilters, validateItem,
} from './itemsLogic';
import { parseItemsCsv } from './csv';

const item = (over: Partial<Item> = {}): Item => ({ ...EMPTY_ITEM, id: 'i1', sku: 'A-1', name: 'Anchor bolt', ...over });

describe('list URL state', () => {
  it('reads defaults and ignores junk', () => {
    const s = readListState(new URLSearchParams('sort=tenant_id&status=x&page=-3&alert=boom'));
    expect(s).toMatchObject({ sort: 'sku', status: 'active', page: 1, alert: '' });
    expect(toFilters(s)).toMatchObject({ active: true, limit: 50, offset: 0 });
  });

  it('maps saved filters to API params', () => {
    const s = readListState(new URLSearchParams('q=bolt&type=goods&status=all&tax=std&min=5&alert=below_min&sort=margin&desc=1&page=3'));
    expect(toFilters(s)).toMatchObject({
      q: 'bolt', item_type: 'goods', active: undefined, tax_code: 'std', min_price: '5',
      alert: 'below_min', sort: 'margin', desc: true, offset: 100,
    });
    expect(activeFilterCount(s)).toBe(5);
  });

  it('toggles sort direction on the same column', () => {
    expect(nextSort({ sort: 'name', desc: false }, 'name')).toEqual({ sort: 'name', desc: true });
    expect(nextSort({ sort: 'name', desc: true }, 'sales_price')).toEqual({ sort: 'sales_price', desc: false });
  });
});

describe('item helpers', () => {
  it('derives initials, margin tone and stock level', () => {
    expect(initials('anchor bolt m8')).toBe('AB');
    expect(initials('Cement')).toBe('CE');
    expect([marginTone(null), marginTone(-1), marginTone(10), marginTone(35)]).toEqual(['neutral', 'danger', 'warning', 'success']);
    expect(stockLevel(item(), '5')).toBe('none');
    expect(stockLevel(item({ stock_tracked: true, min_stock: '10' }), '5')).toBe('low');
    expect(stockLevel(item({ stock_tracked: true }), '0')).toBe('out');
    expect(stockLevel(item({ stock_tracked: true, min_stock: '2' }), '5')).toBe('ok');
  });

  it('computes the price for a target margin', () => {
    expect(priceForMargin('60', '40')).toBe('100.00');
    expect(priceForMargin('10', '100')).toBeNull();
  });

  it('validates and normalises the form', () => {
    expect(validateItem({ ...EMPTY_ITEM })).toMatchObject({ sku: 'items.err_required', name: 'items.err_required' });
    const bad = validateItem({ ...EMPTY_ITEM, sku: 'X', name: 'Y', sales_price: 'abc', currency: 'EU', item_type: 'service', stock_tracked: true });
    expect(Object.keys(bad).sort()).toEqual(['currency', 'sales_price', 'stock_tracked']);
    expect(validateItem({ ...EMPTY_ITEM, sku: 'X', name: 'Y', sales_price: '12,50' })).toEqual({});
    expect(normaliseItem({ ...EMPTY_ITEM, sku: ' X ', name: 'Y', sales_price: '12,50', min_stock: '', currency: 'usd' }))
      .toMatchObject({ sku: 'X', sales_price: '12.50', min_stock: '0', currency: 'USD' });
    expect(isDirty(EMPTY_ITEM, { ...EMPTY_ITEM })).toBe(false);
    expect(isDirty(EMPTY_ITEM, { ...EMPTY_ITEM, notes: 'x' })).toBe(true);
  });

  it('exports CSV that the importer reads back', () => {
    const csv = itemsToCsv([item({ name: 'Bolt, "M8"', sales_price: '1.5', stock_tracked: true, category_id: 'c1' })], new Map([['c1', 'Fixings']]), { i1: '7' });
    expect(csv.split('\n')[1]).toContain('"Bolt, ""M8"""');
    expect(csv).toContain('Fixings');
    expect(parseItemsCsv(csv)[0]).toMatchObject({ sku: 'A-1', name: 'Bolt, "M8"', sales_price: '1.5', stock_tracked: true });
  });

  it('builds a category tree with rolled-up counts', () => {
    const cats = [
      { id: 'b', name: 'Bolts', parent_id: 'f', description: '' },
      { id: 'f', name: 'Fixings', parent_id: null, description: '' },
      { id: 'o', name: 'Orphan', parent_id: 'gone', description: '' },
    ];
    const tree = buildCategoryTree(cats, [{ category_id: 'f', count: 2 }, { category_id: 'b', count: 3 }]);
    expect(tree.map((c) => [c.name, c.depth, c.count, c.total])).toEqual([
      ['Fixings', 0, 2, 5], ['Bolts', 1, 3, 3], ['Orphan', 0, 0, 0],
    ]);
  });
});
