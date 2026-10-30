// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/** Receivables insights: built from the aging report the page already loaded. */
import { useTranslation } from 'react-i18next';
import type { InsightDataset, InsightDef } from '@/features/insights';
import { BUCKETS, type Aging } from './api';

type Translate = ReturnType<typeof useTranslation>['t'];

const BUCKET_LABEL: Record<string, string> = {
  current: 'Not due', d1_30: '1–30', d31_60: '31–60', d61_90: '61–90', d90_plus: '90+',
};

type Row = { [key: string]: string | number };

function num(v: string | number | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function buildReceivablesInsights(
  aging: Aging | undefined,
  currency: string,
  t: Translate,
): { datasets: InsightDataset[]; builtins: InsightDef[] } {
  const unknown = t('receivables.insights.unknown', { defaultValue: 'Unknown' });
  const rows: Row[] = (aging?.rows ?? []).map((r) => {
    const total = num(r.total);
    const notDue = num(r.current);
    return {
      customer: (r.customer_name || '').trim() || unknown,
      total,
      overdue: total - notDue,
      invoices: r.invoices.length,
    };
  });
  const bucketRows: Row[] = aging
    ? BUCKETS.map((b) => ({
        bucket: t(`receivables.bucket_${b}`, { defaultValue: BUCKET_LABEL[b] }),
        amount: num(aging.totals[b]),
      }))
    : [];

  const datasets: InsightDataset[] = [
    {
      id: 'receivables',
      label: t('receivables.insights.ds_customers', { defaultValue: 'Customer balances' }),
      currency,
      fields: [
        { key: 'customer', label: t('receivables.insights.f_customer', { defaultValue: 'Customer' }), kind: 'dimension' },
        { key: 'total', label: t('receivables.insights.f_total', { defaultValue: 'Open amount' }), kind: 'measure', format: 'currency' },
        { key: 'overdue', label: t('receivables.insights.f_overdue', { defaultValue: 'Overdue amount' }), kind: 'measure', format: 'currency' },
        { key: 'invoices', label: t('receivables.insights.f_invoices', { defaultValue: 'Open invoices' }), kind: 'measure', format: 'number' },
      ],
      rows,
    },
    {
      id: 'receivables-buckets',
      label: t('receivables.insights.ds_buckets', { defaultValue: 'Aging buckets' }),
      currency,
      fields: [
        { key: 'bucket', label: t('receivables.insights.f_bucket', { defaultValue: 'Days overdue' }), kind: 'dimension' },
        { key: 'amount', label: t('receivables.insights.f_amount', { defaultValue: 'Amount' }), kind: 'measure', format: 'currency' },
      ],
      rows: bucketRows,
    },
  ];

  const base = { datasetId: 'receivables', builtin: true } as const;
  const builtins: InsightDef[] = [
    { ...base, id: 'kpi-customers', title: t('receivables.insights.k_customers', { defaultValue: 'Customers with open items' }), chart: 'kpi', agg: 'count', color: 0 },
    { ...base, id: 'kpi-open', title: t('receivables.insights.k_open', { defaultValue: 'Total outstanding' }), chart: 'kpi', measure: 'total', agg: 'sum', color: 4 },
    { ...base, id: 'kpi-overdue', title: t('receivables.insights.k_overdue', { defaultValue: 'Overdue' }), chart: 'kpi', measure: 'overdue', agg: 'sum', color: 1 },
    { ...base, id: 'bar-by-customer', title: t('receivables.insights.c_by_customer', { defaultValue: 'Outstanding by customer' }), chart: 'bar', dimension: 'customer', measure: 'total', agg: 'sum', color: 0 },
    { datasetId: 'receivables-buckets', builtin: true, id: 'bar-by-bucket', title: t('receivables.insights.c_by_bucket', { defaultValue: 'Outstanding by days overdue' }), chart: 'bar', dimension: 'bucket', measure: 'amount', agg: 'sum', color: 1 },
  ];
  return { datasets, builtins };
}
