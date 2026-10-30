/** Minimal CSV -> item rows for bulk import (header row names the item fields). */

import { ITEM_TYPES, type ItemInput } from './api';

const FIELDS = new Set<keyof ItemInput>([
  'sku', 'name', 'description', 'item_type', 'uom', 'sales_price', 'purchase_cost', 'currency',
  'tax_code', 'revenue_account', 'expense_account', 'stock_tracked', 'barcode', 'active', 'min_stock', 'reorder_qty', 'notes',
]);

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const truthy = (v: string) => ['1', 'true', 'yes', 'y', 'x'].includes(v.toLowerCase());

/** Parse CSV text (comma or semicolon). Rows without sku or name are skipped. */
export function parseItemsCsv(text: string): Partial<ItemInput>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  const header = splitLine(lines[0]!, sep).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const rows: Partial<ItemInput>[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, sep);
    const row: Record<string, unknown> = {};
    header.forEach((h, i) => {
      const v = cells[i] ?? '';
      if (!FIELDS.has(h as keyof ItemInput) || v === '') return;
      if (h === 'stock_tracked' || h === 'active') row[h] = truthy(v);
      else if (h === 'sales_price' || h === 'purchase_cost' || h === 'min_stock' || h === 'reorder_qty') row[h] = v.replace(',', '.');
      else if (h === 'item_type') row[h] = (ITEM_TYPES as string[]).includes(v.toLowerCase()) ? v.toLowerCase() : 'goods';
      else if (h === 'currency') row[h] = v.toUpperCase();
      else row[h] = v;
    });
    if (row.sku && row.name) rows.push(row as Partial<ItemInput>);
  }
  return rows;
}
