/** API helpers for the item master (products & services), backed by /api/v1/items/. */

import { apiDelete, apiGet, apiPatch, apiPost } from '@/shared/lib/api';

export type ItemType = 'goods' | 'service' | 'consumable';
export const ITEM_TYPES: ItemType[] = ['goods', 'service', 'consumable'];

export interface Item {
  id: string;
  sku: string;
  name: string;
  description: string;
  item_type: ItemType;
  uom: string;
  sales_price: string;
  purchase_cost: string;
  currency: string;
  tax_code: string;
  revenue_account: string;
  expense_account: string;
  stock_tracked: boolean;
  barcode: string;
  category_id: string | null;
  active: boolean;
  min_stock: string;
  reorder_qty: string;
  default_supplier_id: string | null;
  image_url: string;
  notes: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export type ItemInput = Omit<Item, 'id' | 'created_at' | 'updated_at'>;

export interface ItemPage {
  items: Item[];
  total: number;
  on_hand: Record<string, string>;
}

export interface ItemStats {
  total: number;
  active: number;
  inactive: number;
  goods: number;
  services: number;
  consumables: number;
  stock_tracked: number;
  avg_margin_pct: string | null;
  without_price: number;
  below_min_stock: number;
  categories: number;
}

export type BulkAction = 'activate' | 'deactivate' | 'set_category' | 'set_tax_code' | 'adjust_prices' | 'delete';
export interface BulkInput {
  ids: string[];
  action: BulkAction;
  category_id?: string | null;
  tax_code?: string;
  pct?: string;
  target?: 'sales' | 'cost' | 'both';
}

export interface SalesHistoryRow {
  document_id: string;
  kind: string;
  number: string;
  status: string;
  doc_date: string;
  customer_name: string;
  currency: string;
  qty: string;
  unit_price: string;
  discount_pct: string;
  net: string;
}

export interface PurchaseHistoryRow {
  order_id: string;
  number: string;
  status: string;
  doc_date: string;
  supplier_name: string;
  currency: string;
  qty: string;
  qty_received: string;
  unit_price: string;
  net: string;
}

export interface ItemPriceBreakRow {
  price_list_id: string;
  price_list_name: string;
  currency: string;
  customer_group: string;
  customer_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
  min_qty: string;
  unit_price: string;
}

export interface ItemCategory {
  id: string;
  name: string;
  parent_id: string | null;
  description: string;
}

export interface PriceBreak {
  id?: string;
  item_id: string;
  min_qty: string;
  unit_price: string;
}

export interface PriceList {
  id: string;
  name: string;
  currency: string;
  customer_group: string;
  customer_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  priority: number;
  active: boolean;
  items: PriceBreak[];
}

export type PriceListInput = Omit<PriceList, 'id'>;

export interface ItemFilters {
  q?: string;
  item_type?: string;
  category_id?: string;
  active?: boolean;
  tax_code?: string;
  min_price?: string;
  max_price?: string;
  alert?: 'below_min' | 'no_price' | '';
  sort?: SortKey;
  desc?: boolean;
  limit?: number;
  offset?: number;
}

export type SortKey = 'sku' | 'name' | 'sales_price' | 'purchase_cost' | 'item_type' | 'uom' | 'tax_code' | 'updated_at' | 'margin';

export interface PriceQuote {
  item_id: string;
  currency: string;
  qty: string;
  list_price: string;
  discount_pct: string;
  unit_price: string;
  source: 'item' | 'price_list';
  price_list_id: string | null;
  discount_rule_id: string | null;
}

/** Build a query string, dropping empty values. */
export function toQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const EMPTY_ITEM: ItemInput = {
  sku: '',
  name: '',
  description: '',
  item_type: 'goods',
  uom: 'pcs',
  sales_price: '0',
  purchase_cost: '0',
  currency: 'EUR',
  tax_code: '',
  revenue_account: '',
  expense_account: '',
  stock_tracked: false,
  barcode: '',
  category_id: null,
  active: true,
  min_stock: '0',
  reorder_qty: '0',
  default_supplier_id: null,
  image_url: '',
  notes: '',
};

const B = '/v1/items';

export const itemsApi = {
  list: (f: ItemFilters = {}) => apiGet<ItemPage>(`${B}/${toQuery({ ...f })}`),
  stats: () => apiGet<ItemStats>(`${B}/stats/`),
  bulk: (body: BulkInput) => apiPost<{ affected: number }>(`${B}/bulk/`, body),
  duplicate: (id: string) => apiPost<Item>(`${B}/${id}/duplicate/`, {}),
  salesHistory: (id: string) => apiGet<SalesHistoryRow[]>(`${B}/${id}/sales-history/`),
  purchases: (id: string) => apiGet<PurchaseHistoryRow[]>(`${B}/${id}/purchases/`),
  priceBreaks: (id: string) => apiGet<ItemPriceBreakRow[]>(`${B}/${id}/price-breaks/`),
  categoryCounts: () => apiGet<{ category_id: string | null; count: number }[]>(`${B}/categories/counts/`),
  updateCategory: (id: string, body: Partial<Pick<ItemCategory, 'name' | 'parent_id' | 'description'>>) =>
    apiPatch<ItemCategory>(`${B}/categories/${id}/`, body),
  removeCategory: (id: string) => apiDelete(`${B}/categories/${id}/`),
  get: (id: string) => apiGet<Item>(`${B}/${id}/`),
  create: (body: ItemInput) => apiPost<Item>(`${B}/`, body),
  update: (id: string, body: Partial<ItemInput>) => apiPatch<Item>(`${B}/${id}/`, body),
  remove: (id: string) => apiDelete(`${B}/${id}/`),
  importItems: (rows: Partial<ItemInput>[]) => apiPost<{ created: number; updated: number }>(`${B}/import/`, rows),
  categories: () => apiGet<ItemCategory[]>(`${B}/categories/`),
  createCategory: (name: string, parent_id: string | null = null) =>
    apiPost<ItemCategory>(`${B}/categories/`, { name, parent_id }),
  priceLists: () => apiGet<PriceList[]>(`${B}/price-lists/`),
  createPriceList: (body: PriceListInput) => apiPost<PriceList>(`${B}/price-lists/`, body),
  updatePriceList: (id: string, body: Partial<PriceListInput>) => apiPatch<PriceList>(`${B}/price-lists/${id}/`, body),
  removePriceList: (id: string) => apiDelete(`${B}/price-lists/${id}/`),
  resolvePrice: (p: { item_id: string; qty?: string; on_date?: string; customer_id?: string; customer_group?: string; currency?: string }) =>
    apiGet<PriceQuote>(`${B}/price/${toQuery(p)}`),
};

/** Gross margin % of sales price over purchase cost; null when price is zero. */
export function marginPct(salesPrice: string | number, cost: string | number): number | null {
  const p = Number(salesPrice) || 0;
  const c = Number(cost) || 0;
  if (p <= 0) return null;
  return Math.round(((p - c) / p) * 1000) / 10;
}

export const TYPE_VARIANT: Record<ItemType, 'neutral' | 'blue' | 'warning'> = {
  goods: 'blue',
  service: 'neutral',
  consumable: 'warning',
};
