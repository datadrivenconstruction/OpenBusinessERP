import { describe, expect, it } from 'vitest';
import { marginPct, toQuery } from './api';
import { parseItemsCsv } from './csv';

describe('items helpers', () => {
  it('builds a query string without empty values', () => {
    expect(toQuery({ q: 'bolt', item_type: '', active: true, category_id: undefined })).toBe('?q=bolt&active=true');
    expect(toQuery({})).toBe('');
  });

  it('computes margin on sales price', () => {
    expect(marginPct('100', '60')).toBe(40);
    expect(marginPct('0', '5')).toBeNull();
  });

  it('parses semicolon CSV with quotes, flags and decimal commas', () => {
    const csv = '﻿SKU;Name;Item type;Sales price;Stock tracked\n' +
      'B-1;"Bolt; M8";goods;0,25;yes\n' +
      'S-1;Install;SERVICE;80;no\n' +
      ';missing sku;goods;1;no\n';
    expect(parseItemsCsv(csv)).toEqual([
      { sku: 'B-1', name: 'Bolt; M8', item_type: 'goods', sales_price: '0.25', stock_tracked: true },
      { sku: 'S-1', name: 'Install', item_type: 'service', sales_price: '80', stock_tracked: false },
    ]);
  });
});
