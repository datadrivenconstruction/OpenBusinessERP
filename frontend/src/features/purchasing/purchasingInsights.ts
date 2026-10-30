// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/** Purchasing insights: built from the list the page already loaded (orders, bills or receipts). */
import { useTranslation } from 'react-i18next';
import type { InsightDataset, InsightDef } from '@/features/insights';

type Translate = ReturnType<typeof useTranslation>['t'];

export interface PurchasingInsightRow {
  supplier_name: string;
  status: string;
  doc_date: string;
  currency: string;
  /** gross total for orders and bills, value for receipts */
  total: string | number;
  amount_paid?: string | number | null;
  credit?: boolean;
}

function toNum(v: string | number | null | undefined): number {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

type Row = { [key: string]: string | number };

export function buildPurchasingInsights(
  docs: PurchasingInsightRow[],
  tab: string,
  t: Translate,
): { datasets: InsightDataset[]; builtins: InsightDef[] } {
  const unknown = t('purchasing.insights.unknown', { defaultValue: 'Unknown' });
  const rows: Row[] = [...docs]
    .sort((a, b) => new Date(a.doc_date).getTime() - new Date(b.doc_date).getTime())
    .map((d) => {
      const sign = d.credit ? -1 : 1;
      const total = sign * toNum(d.total);
      return {
        supplier: (d.supplier_name || '').trim() || unknown,
        status: t(`purchasing.status_${d.status}`, { defaultValue: d.status.replace('_', ' ') }),
        month: monthKey(d.doc_date),
        total,
        open: d.amount_paid === undefined ? 0 : total - sign * toNum(d.amount_paid),
      };
    });

  const dataset: InsightDataset = {
    id: 'purchasing',
    label: t('purchasing.insights.ds_docs', { defaultValue: 'Purchasing documents' }),
    currency: docs[0]?.currency || '',
    fields: [
      { key: 'supplier', label: t('purchasing.insights.f_supplier', { defaultValue: 'Supplier' }), kind: 'dimension' },
      { key: 'status', label: t('purchasing.insights.f_status', { defaultValue: 'Status' }), kind: 'dimension' },
      { key: 'month', label: t('purchasing.insights.f_month', { defaultValue: 'Month' }), kind: 'dimension' },
      { key: 'total', label: t('purchasing.insights.f_total', { defaultValue: 'Amount' }), kind: 'measure', format: 'currency' },
      { key: 'open', label: t('purchasing.insights.f_open', { defaultValue: 'Open amount' }), kind: 'measure', format: 'currency' },
    ],
    rows,
  };

  const base = { datasetId: 'purchasing', builtin: true } as const;
  const builtins: InsightDef[] = [
    { ...base, id: 'kpi-docs', title: t('purchasing.insights.k_docs', { defaultValue: 'Documents' }), chart: 'kpi', agg: 'count', color: 0 },
    { ...base, id: 'kpi-total', title: t('purchasing.insights.k_total', { defaultValue: 'Total amount' }), chart: 'kpi', measure: 'total', agg: 'sum', color: 4 },
    ...(tab === 'bills'
      ? [{ ...base, id: 'kpi-open', title: t('purchasing.insights.k_open', { defaultValue: 'Open amount' }), chart: 'kpi', measure: 'open', agg: 'sum', color: 1 } as InsightDef]
      : []),
    { ...base, id: 'bar-by-supplier', title: t('purchasing.insights.c_by_supplier', { defaultValue: 'Amount by supplier' }), chart: 'bar', dimension: 'supplier', measure: 'total', agg: 'sum', color: 0 },
    { ...base, id: 'donut-by-status', title: t('purchasing.insights.c_by_status', { defaultValue: 'Documents by status' }), chart: 'donut', dimension: 'status', agg: 'count', color: 4 },
    { ...base, id: 'area-over-time', title: t('purchasing.insights.c_over_time', { defaultValue: 'Amount over time' }), chart: 'area', dimension: 'month', measure: 'total', agg: 'sum', color: 5 },
  ];
  return { datasets: [dataset], builtins };
}
