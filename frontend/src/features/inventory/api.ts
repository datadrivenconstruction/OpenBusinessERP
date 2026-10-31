/** API helpers for inventory (warehouses, movements, stocktakes), backed by /api/v1/inventory/. */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/shared/lib/api';

export type MoveKind = 'opening' | 'receipt' | 'delivery' | 'transfer_in' | 'transfer_out' | 'adjustment';
export const MOVE_KINDS: MoveKind[] = ['opening', 'receipt', 'delivery', 'transfer_in', 'transfer_out', 'adjustment'];

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string;
  is_default: boolean;
  active: boolean;
}

export interface Movement {
  id: string;
  item_id: string;
  sku: string;
  item_name: string;
  uom: string;
  warehouse_id: string;
  warehouse_code: string;
  kind: MoveKind;
  move_date: string;
  qty: string;
  unit_cost: string;
  value: string;
  source_type: string;
  source_id: string;
  source_number: string;
  reversal_of_id: string | null;
  reversed: boolean;
  gl_entry_id: string | null;
  notes: string;
  created_at: string;
}

export interface StockLevel {
  item_id: string;
  sku: string;
  name: string;
  uom: string;
  active: boolean;
  on_hand: string;
  by_warehouse: Record<string, string>;
  reserved: string;
  available: string;
  avg_cost: string;
  value: string;
  min_stock: string;
  reorder_qty: string;
  below_min: boolean;
}

export interface ItemStock {
  item_id: string;
  stock_tracked: boolean;
  on_hand: string;
  reserved: string;
  available: string;
  avg_cost: string;
  value: string;
  warehouses: { warehouse_id: string; code: string; name: string; qty: string }[];
  movements: Movement[];
  movement_count: number;
}

export interface StocktakeLine {
  id: string;
  line_no: number;
  item_id: string;
  sku: string;
  name: string;
  uom: string;
  expected_qty: string;
  counted_qty: string | null;
  unit_cost: string;
  diff_qty: string;
  diff_value: string;
}

export interface Stocktake {
  id: string;
  number: string;
  warehouse_id: string;
  status: 'draft' | 'posted' | 'cancelled';
  count_date: string;
  notes: string;
  diff_value: string;
  gl_entry_id: string | null;
  created_at: string;
  lines: StocktakeLine[];
}

export interface InventorySummary {
  items: number;
  total_value: string;
  below_min: number;
  out_of_stock: number;
  reserved_items: number;
  warehouses: number;
}

export interface InventorySettings {
  allow_negative: boolean;
  inventory_account: string;
  cogs_account: string;
  diff_account: string;
  effective: Record<string, string | null>;
}

export interface MovementFilters {
  item_id?: string;
  warehouse_id?: string;
  kind?: string;
  date_from?: string;
  date_to?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

const B = '/v1/inventory';

interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export const inventoryApi = {
  summary: () => apiGet<InventorySummary>(`${B}/summary/`),
  warehouses: () => apiGet<Page<Warehouse>>(`${B}/warehouses/`).then((r) => r.items),
  createWarehouse: (body: { code: string; name: string; address?: string; is_default?: boolean }) =>
    apiPost<Warehouse>(`${B}/warehouses/`, body),
  updateWarehouse: (id: string, body: Partial<Omit<Warehouse, 'id'>>) => apiPatch<Warehouse>(`${B}/warehouses/${id}/`, body),
  stock: (f: { warehouse_id?: string; q?: string; low_only?: boolean } = {}) => apiGet<Page<StockLevel>>(`${B}/stock/${qs(f)}`).then((r) => r.items),
  item: (itemId: string) => apiGet<ItemStock>(`${B}/items/${itemId}/`),
  movements: (f: MovementFilters = {}) =>
    apiGet<{ items: Movement[]; total: number }>(`${B}/movements/${qs({ ...f })}`),
  transfer: (body: { item_id: string; from_warehouse_id: string; to_warehouse_id: string; qty: string; move_date?: string; notes?: string }) =>
    apiPost<unknown>(`${B}/transfers/`, body),
  adjust: (body: { item_id: string; warehouse_id?: string; kind: 'adjustment' | 'opening'; qty: string; unit_cost?: string; move_date?: string; notes?: string }) =>
    apiPost<unknown>(`${B}/adjustments/`, body),
  stocktakes: () => apiGet<Page<Stocktake>>(`${B}/stocktakes/`).then((r) => r.items),
  stocktake: (id: string) => apiGet<Stocktake>(`${B}/stocktakes/${id}/`),
  createStocktake: (body: { warehouse_id?: string; count_date?: string; notes?: string }) =>
    apiPost<Stocktake>(`${B}/stocktakes/`, body),
  saveCounts: (id: string, counts: { line_id: string; counted_qty: string | null }[]) =>
    apiPut<Stocktake>(`${B}/stocktakes/${id}/counts/`, { counts }),
  postStocktake: (id: string) => apiPost<Stocktake>(`${B}/stocktakes/${id}/post/`),
  cancelStocktake: (id: string) => apiPost<Stocktake>(`${B}/stocktakes/${id}/cancel/`),
  deleteStocktake: (id: string) => apiDelete(`${B}/stocktakes/${id}/`),
  settings: () => apiGet<InventorySettings>(`${B}/settings/`),
  saveSettings: (body: Partial<Omit<InventorySettings, 'effective'>>) => apiPut<InventorySettings>(`${B}/settings/`, body),
};

/** Where a movement's source document lives in the app, if anywhere. */
export function sourceLink(m: Pick<Movement, 'source_type' | 'source_id' | 'source_number'>): string | null {
  if (m.source_type === 'purchasing_receipt') return `/purchasing?tab=receipts&q=${encodeURIComponent(m.source_number)}`;
  if (m.source_type === 'sales_delivery' && m.source_id) return `/sales?doc=${m.source_id}`;
  return null;
}
