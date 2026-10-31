/** Aging tab: chart with bucket filter, customer table; a row opens the customer drawer. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AlertTriangle, ChevronRight, FileDown, Scale, Search } from 'lucide-react';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card, EmptyState, SkeletonTable } from '@/shared/ui';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { getErrorMessage } from '@/shared/lib/api';
import { BUCKETS, filterByBucket, overdueShare, receivablesApi, type Aging, type AgingRow, type BucketFilter } from '../api';
import { AgingChart } from './AgingChart';
import { BUCKET_LABEL, inputCls, td, th } from './shared';

interface Props {
  aging: UseQueryResult<Aging>;
  asOf: string;
  setAsOf: (v: string) => void;
  cur: string;
  bucket: BucketFilter | null;
  setBucket: (b: BucketFilter | null) => void;
  onOpenCustomer: (partnerKey: string) => void;
}

/** Open amounts per non-base document currency (aging buckets themselves are in base currency). */
function foreignTotals(r: AgingRow, base: string): [string, number][] {
  const sums = new Map<string, number>();
  for (const i of r.invoices) if (i.currency !== base) sums.set(i.currency, (sums.get(i.currency) ?? 0) + Number(i.open));
  return [...sums];
}

export function AgingTab({ aging, asOf, setAsOf, cur, bucket, setBucket, onOpenCustomer }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const blocks = useQuery({ queryKey: ['receivables', 'blocks'], queryFn: receivablesApi.blocks });
  const blocked = new Map((blocks.data ?? []).map((b) => [b.partner_key, b.id]));
  const toggle = useMutation({
    mutationFn: async ({ key, name }: { key: string; name: string }) => {
      const id = blocked.get(key);
      if (id) await receivablesApi.unblock(id);
      else await receivablesApi.block(key, name);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['receivables'] }),
  });
  const data = aging.data;
  const needle = search.trim().toLowerCase();
  const rows = filterByBucket(data?.rows ?? [], bucket).filter(
    (r) => !needle || (r.customer_name || '').toLowerCase().includes(needle),
  );

  return (
    <div className="space-y-5" id="receivables-panel-aging" role="tabpanel" aria-labelledby="receivables-tab-aging">
      {data && data.rows.length > 0 && (
        <AgingChart aging={data} currency={cur} selected={bucket === 'overdue' ? null : bucket} onSelect={setBucket} />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-content-secondary">
          {t('receivables.as_of', { defaultValue: 'As of' })}
          <input type="date" className={inputCls} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <label className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-tertiary" />
          <input
            type="search"
            className={clsx(inputCls, 'w-56 pl-8')}
            value={search}
            placeholder={t('receivables.search_customer', { defaultValue: 'Find a customer' })}
            aria-label={t('receivables.search_customer', { defaultValue: 'Find a customer' })}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {bucket && (
          <Badge variant="blue">
            {t('receivables.filtered_by', { defaultValue: 'Only: {{bucket}}', bucket: bucket === 'overdue' ? t('receivables.kpi_overdue', { defaultValue: 'Past due' }) : t(`receivables.bucket_${bucket}`, { defaultValue: BUCKET_LABEL[bucket] }) })}
          </Badge>
        )}
      </div>
      <Card padding="none">
        {aging.isLoading ? (
          <div className="p-4">
            <SkeletonTable rows={8} columns={8} />
          </div>
        ) : aging.isError ? (
          <EmptyState
            icon={<AlertTriangle size={22} />}
            title={t('receivables.load_error', { defaultValue: "We couldn't load receivables right now." })}
            description={getErrorMessage(aging.error)}
            action={{ label: t('common.retry', { defaultValue: 'Try again' }), onClick: () => void aging.refetch() }}
          />
        ) : data && data.rows.length === 0 ? (
          <EmptyState icon={<Scale size={22} />} title={t('receivables.empty', { defaultValue: 'No open customer invoices.' })} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Search size={22} />}
            title={t('receivables.no_match', { defaultValue: 'No customer matches this filter.' })}
            action={{
              label: t('receivables.clear_filter', { defaultValue: 'Show all customers' }),
              onClick: () => { setBucket(null); setSearch(''); },
            }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary text-content-tertiary text-xs uppercase tracking-wide">
                <tr>
                  <th className={clsx(th, 'text-left')}>{t('receivables.col_customer', { defaultValue: 'Customer' })}</th>
                  {BUCKETS.map((b) => (
                    <th
                      key={b}
                      className={clsx(th, 'cursor-pointer text-right hover:text-content-primary', bucket === b && 'text-oe-blue')}
                      onClick={() => setBucket(bucket === b ? null : b)}
                    >
                      {t(`receivables.bucket_${b}`, { defaultValue: BUCKET_LABEL[b] })}
                    </th>
                  ))}
                  <th className={clsx(th, 'text-right')}>{t('receivables.col_total', { defaultValue: 'Total' })}</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.partner_key}
                    className="cursor-pointer border-t border-border-light hover:bg-surface-secondary"
                    onClick={() => onOpenCustomer(r.partner_key)}
                  >
                    <td className={td}>
                      <span className="font-medium">{r.customer_name || '—'}</span>{' '}
                      <span className="text-xs text-content-tertiary">
                        {t('receivables.invoice_count', { defaultValue: '{{count}} invoices', count: r.invoices.length })}
                        {overdueShare(r) > 0 && ` · ${overdueShare(r)}% ${t('receivables.overdue', { defaultValue: 'overdue' })}`}
                        {foreignTotals(r, cur).map(([c, v]) => (
                          <span key={c} title={t('receivables.doc_currency_open', { defaultValue: 'Open in document currency' })}>
                            {' · '}
                            <MoneyDisplay amount={v} currency={c} />
                          </span>
                        ))}
                      </span>
                      {blocked.has(r.partner_key) && (
                        <Badge variant="neutral" className="ml-2">{t('receivables.blocked', { defaultValue: 'No dunning' })}</Badge>
                      )}
                    </td>
                    {BUCKETS.map((b) => (
                      <td key={b} className={clsx(td, 'text-right tabular-nums', bucket === b && 'font-semibold')}>
                        {Number(r[b]) ? <MoneyDisplay amount={r[b]} currency={cur} /> : ''}
                      </td>
                    ))}
                    <td className={clsx(td, 'text-right font-medium tabular-nums')}>
                      <MoneyDisplay amount={r.total} currency={cur} />
                    </td>
                    <td className={clsx(td, 'whitespace-nowrap text-right')} onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<FileDown size={14} />}
                        onClick={() => receivablesApi.statement(r.partner_key)}
                      >
                        {t('receivables.statement', { defaultValue: 'Statement' })}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate({ key: r.partner_key, name: r.customer_name })}
                      >
                        {blocked.has(r.partner_key)
                          ? t('receivables.unblock', { defaultValue: 'Allow dunning' })
                          : t('receivables.block', { defaultValue: 'Exclude from dunning' })}
                      </Button>
                      <ChevronRight size={14} className="ml-1 inline text-content-tertiary" />
                    </td>
                  </tr>
                ))}
              </tbody>
              {data && !bucket && !needle && (
                <tfoot className="border-t border-border-light font-medium">
                  <tr>
                    <td className={td}>{t('receivables.col_total', { defaultValue: 'Total' })}</td>
                    {BUCKETS.map((b) => (
                      <td key={b} className={clsx(td, 'text-right tabular-nums')}>
                        <MoneyDisplay amount={data.totals[b]} currency={cur} />
                      </td>
                    ))}
                    <td className={clsx(td, 'text-right tabular-nums')}>
                      <MoneyDisplay amount={data.totals.total} currency={cur} />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
