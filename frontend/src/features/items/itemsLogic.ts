/** Pure helpers for the products & services screens (URL state, validation, CSV, tree). */

import type { Item, ItemCategory, ItemFilters, ItemInput, SortKey } from './api';
import { fmtNumberForInput } from '@/shared/lib/formatters';
import { compareNames } from '@/shared/lib/collator';

export const PAGE_SIZE = 50;
const SORT_KEYS: SortKey[] = ['sku', 'name', 'sales_price', 'purchase_cost', 'item_type', 'uom', 'tax_code', 'updated_at', 'margin'];

/** Everything the list shows is driven by the URL so a filtered view can be bookmarked or shared. */
export interface ListState {
  q: string;
  type: string;
  category: string;
  status: 'active' | 'inactive' | 'all';
  tax: string;
  min: string;
  max: string;
  alert: '' | 'below_min' | 'no_price';
  sort: SortKey;
  desc: boolean;
  page: number;
}

export function readListState(p: URLSearchParams): ListState {
  const status = p.get('status');
  const alert = p.get('alert');
  const sort = p.get('sort') as SortKey | null;
  return {
    q: p.get('q') ?? '',
    type: p.get('type') ?? '',
    category: p.get('category') ?? '',
    status: status === 'inactive' || status === 'all' ? status : 'active',
    tax: p.get('tax') ?? '',
    min: p.get('min') ?? '',
    max: p.get('max') ?? '',
    alert: alert === 'below_min' || alert === 'no_price' ? alert : '',
    sort: sort && SORT_KEYS.includes(sort) ? sort : 'sku',
    desc: p.get('desc') === '1',
    page: Math.max(1, Number(p.get('page')) || 1),
  };
}

export function toFilters(s: ListState): ItemFilters {
  return {
    q: s.q || undefined,
    item_type: s.type || undefined,
    category_id: s.category || undefined,
    active: s.status === 'all' ? undefined : s.status === 'active',
    tax_code: s.tax || undefined,
    min_price: s.min || undefined,
    max_price: s.max || undefined,
    alert: s.alert || undefined,
    sort: s.sort,
    desc: s.desc || undefined,
    limit: PAGE_SIZE,
    offset: (s.page - 1) * PAGE_SIZE,
  };
}

/** Number of narrowing filters in use (search excluded), for the "Filters (n)" badge. */
export function activeFilterCount(s: ListState): number {
  return [s.type, s.category, s.tax, s.min, s.max, s.alert, s.status !== 'active' ? 'x' : ''].filter(Boolean).length;
}

/** Next sort when a column header is clicked: same column flips direction, new column starts ascending. */
export function nextSort(s: Pick<ListState, 'sort' | 'desc'>, key: SortKey): { sort: SortKey; desc: boolean } {
  return s.sort === key ? { sort: key, desc: !s.desc } : { sort: key, desc: false };
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

export function marginTone(pct: number | null): Tone {
  if (pct === null) return 'neutral';
  if (pct < 0) return 'danger';
  if (pct < 20) return 'warning';
  return 'success';
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0]!;
  return (words.length === 1 ? first.slice(0, 2) : first[0]! + words[1]![0]!).toUpperCase();
}

/** Stable pastel hue per item so thumbnails without an image are still recognisable. */
export function avatarHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export type StockLevel = 'none' | 'out' | 'low' | 'ok';

export function stockLevel(item: Pick<Item, 'stock_tracked' | 'min_stock'>, onHand: string | number | undefined): StockLevel {
  if (!item.stock_tracked) return 'none';
  const qty = Number(onHand ?? 0) || 0;
  const min = Number(item.min_stock) || 0;
  if (qty <= 0) return 'out';
  if (min > 0 && qty < min) return 'low';
  return 'ok';
}

/** Sales price that yields the wanted margin on the given cost. */
export function priceForMargin(cost: string | number, marginPct: string | number): string | null {
  const c = Number(cost);
  const m = Number(marginPct);
  if (!Number.isFinite(c) || !Number.isFinite(m) || m >= 100 || c < 0) return null;
  return fmtNumberForInput(Math.round((c / (1 - m / 100)) * 100) / 100);
}

export type FieldErrors = Partial<Record<keyof ItemInput, string>>;

const isNum = (v: string) => v.trim() === '' || (/^-?\d+([.,]\d+)?$/.test(v.trim()) && Number(v.replace(',', '.')) >= 0);

/** Field errors as translation keys; empty object means the form can be saved. */
export function validateItem(f: ItemInput): FieldErrors {
  const e: FieldErrors = {};
  if (!f.sku.trim()) e.sku = 'items.err_required';
  else if (f.sku.length > 64) e.sku = 'items.err_too_long';
  if (!f.name.trim()) e.name = 'items.err_required';
  if (!/^[A-Za-z]{3}$/.test(f.currency)) e.currency = 'items.err_currency';
  if (!f.uom.trim()) e.uom = 'items.err_required';
  for (const k of ['sales_price', 'purchase_cost', 'min_stock', 'reorder_qty'] as const) {
    if (!isNum(String(f[k] ?? ''))) e[k] = 'items.err_number';
  }
  if (f.item_type === 'service' && f.stock_tracked) e.stock_tracked = 'items.err_service_stock';
  return e;
}

export function normaliseItem(f: ItemInput): ItemInput {
  const n = (v: string) => (v.trim() === '' ? '0' : v.replace(',', '.').trim());
  return {
    ...f,
    sku: f.sku.trim(),
    name: f.name.trim(),
    currency: f.currency.toUpperCase(),
    sales_price: n(f.sales_price),
    purchase_cost: n(f.purchase_cost),
    min_stock: n(f.min_stock),
    reorder_qty: n(f.reorder_qty),
  };
}

export function isDirty(a: ItemInput, b: ItemInput): boolean {
  return (Object.keys(a) as (keyof ItemInput)[]).some((k) => String(a[k] ?? '') !== String(b[k] ?? ''));
}

export function toInput(item: Item, base: ItemInput): ItemInput {
  const out = { ...base } as Record<string, unknown>;
  for (const k of Object.keys(base)) {
    const v = (item as unknown as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = typeof v === 'number' ? String(v) : v;
  }
  for (const k of ['sales_price', 'purchase_cost', 'min_stock', 'reorder_qty']) {
    out[k] = String(Number(out[k] ?? 0));
  }
  return out as unknown as ItemInput;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with the same column names the importer reads, so an export can be edited and re-imported. */
export function itemsToCsv(items: Item[], catName: Map<string, string>, onHand: Record<string, string> = {}): string {
  const cols = ['sku', 'name', 'item_type', 'category', 'uom', 'sales_price', 'purchase_cost', 'currency',
    'tax_code', 'stock_tracked', 'on_hand', 'min_stock', 'reorder_qty', 'barcode', 'active', 'description'];
  const lines = [cols.join(',')];
  for (const it of items) {
    const row: Record<string, unknown> = {
      ...it,
      category: (it.category_id && catName.get(it.category_id)) || '',
      on_hand: it.stock_tracked ? Number(onHand[it.id] ?? 0) : '',
      sales_price: Number(it.sales_price),
      purchase_cost: Number(it.purchase_cost),
      min_stock: Number(it.min_stock ?? 0),
      reorder_qty: Number(it.reorder_qty ?? 0),
    };
    lines.push(cols.map((c) => csvCell(row[c])).join(','));
  }
  return lines.join('\n');
}

export interface CategoryNode extends ItemCategory {
  depth: number;
  count: number;
  /** Items in this category and all its sub-categories. */
  total: number;
}

/** Depth-first flattened tree; orphans (missing parent) are shown at the root. */
export function buildCategoryTree(cats: ItemCategory[], counts: { category_id: string | null; count: number }[]): CategoryNode[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const kids = new Map<string | null, ItemCategory[]>();
  for (const c of cats) {
    const parent = c.parent_id && byId.has(c.parent_id) ? c.parent_id : null;
    kids.set(parent, [...(kids.get(parent) ?? []), c]);
  }
  const own = new Map(counts.map((r) => [r.category_id, r.count]));
  const out: CategoryNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number): number => {
    let sum = 0;
    for (const c of (kids.get(parent) ?? []).sort((a, b) => compareNames(a.name, b.name))) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const node: CategoryNode = { ...c, depth, count: own.get(c.id) ?? 0, total: 0 };
      out.push(node);
      node.total = node.count + walk(c.id, depth + 1);
      sum += node.total;
    }
    return sum;
  };
  walk(null, 0);
  return out;
}
