import { useTranslation } from 'react-i18next';
import type { InsightDataset, InsightDef } from '@/features/insights';

type Translate = ReturnType<typeof useTranslation>['t'];

interface ItemLite {
  name: string;
  item_type: string;
  uom: string;
  sales_price: string | number;
  purchase_cost: string | number;
  currency: string;
  category_id: string | null;
  active: boolean;
}

function toNum(v: string | number | null | undefined): number {
  const n = typeof v === 'string' ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? n : 0;
}

interface Row {
  [key: string]: string | number;
  name: string;
  type: string;
  category: string;
  uom: string;
  status: string;
  price: number;
  cost: number;
}

export function buildItemsInsights(
  items: ItemLite[],
  categoryName: Map<string, string>,
  t: Translate,
): { datasets: InsightDataset[]; builtins: InsightDef[] } {
  const none = t('items.insights.uncategorised', { defaultValue: 'Uncategorised' });
  const typeLabel = (x: string) =>
    t(`items.type_${x}`, { defaultValue: x.charAt(0).toUpperCase() + x.slice(1) });
  const rows: Row[] = items.map((it) => ({
    name: it.name ?? '',
    type: typeLabel(it.item_type),
    category: (it.category_id && categoryName.get(it.category_id)) || none,
    uom: it.uom || '—',
    status: it.active
      ? t('items.insights.active', { defaultValue: 'Active' })
      : t('items.insights.inactive', { defaultValue: 'Inactive' }),
    price: toNum(it.sales_price),
    cost: toNum(it.purchase_cost),
  }));

  const dataset: InsightDataset = {
    id: 'items',
    label: t('items.insights.ds_items', { defaultValue: 'Item catalogue' }),
    currency: items[0]?.currency ?? '',
    fields: [
      { key: 'name', label: t('items.insights.f_name', { defaultValue: 'Name' }), kind: 'dimension' },
      { key: 'type', label: t('items.insights.f_type', { defaultValue: 'Type' }), kind: 'dimension' },
      { key: 'category', label: t('items.insights.f_category', { defaultValue: 'Category' }), kind: 'dimension' },
      { key: 'uom', label: t('items.insights.f_uom', { defaultValue: 'Unit' }), kind: 'dimension' },
      { key: 'status', label: t('items.insights.f_status', { defaultValue: 'Status' }), kind: 'dimension' },
      { key: 'price', label: t('items.insights.f_price', { defaultValue: 'Sales price' }), kind: 'measure', format: 'currency' },
      { key: 'cost', label: t('items.insights.f_cost', { defaultValue: 'Purchase cost' }), kind: 'measure', format: 'currency' },
    ],
    rows,
  };

  const base = { datasetId: 'items', builtin: true } as const;
  const builtins: InsightDef[] = [
    { ...base, id: 'kpi-items', title: t('items.insights.k_items', { defaultValue: 'Items' }), chart: 'kpi', agg: 'count', color: 0 },
    { ...base, id: 'kpi-avg-price', title: t('items.insights.k_avg_price', { defaultValue: 'Average sales price' }), chart: 'kpi', measure: 'price', agg: 'avg', color: 4 },
    { ...base, id: 'kpi-avg-cost', title: t('items.insights.k_avg_cost', { defaultValue: 'Average purchase cost' }), chart: 'kpi', measure: 'cost', agg: 'avg', color: 1 },
    { ...base, id: 'donut-by-type', title: t('items.insights.c_by_type', { defaultValue: 'Items by type' }), chart: 'donut', dimension: 'type', agg: 'count', color: 4 },
    { ...base, id: 'bar-by-category', title: t('items.insights.c_by_category', { defaultValue: 'Items by category' }), chart: 'bar', dimension: 'category', agg: 'count', color: 0 },
    { ...base, id: 'bar-by-uom', title: t('items.insights.c_by_uom', { defaultValue: 'Items by unit' }), chart: 'bar', dimension: 'uom', agg: 'count', color: 5 },
  ];
  return { datasets: [dataset], builtins };
}
