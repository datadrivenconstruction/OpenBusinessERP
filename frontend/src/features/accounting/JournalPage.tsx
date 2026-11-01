import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { fmtMoney } from '@/features/sales/api';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { STATUS_VARIANT, glApi, toCents } from './api';
import { AccountingShell, EmptyBlock, ErrorBlock, Field, LoadingBlock, SourceChip, inputCls, numCls, thCls } from './ui';
import { DateField } from '@/shared/ui/DateField';

const STATUSES = ['draft', 'posted', 'reversed'] as const;

export function JournalPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const source = params.get('source') ?? '';
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  const filters = { status: status || undefined, date_from: from || undefined, date_to: to || undefined, source_type: source.trim() || undefined };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['gl', 'entries', filters],
    queryFn: () => glApi.entries(filters),
    retry: false,
  });
  const filtered = !!(status || from || to || source);

  return (
    <AccountingShell
      title={t('accounting.tab_journal', { defaultValue: 'Journal' })}
      actions={
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => navigate('/accounting/journal/new')}>
          {t('accounting.new_entry', { defaultValue: 'New entry' })}
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('accounting.col_status', { defaultValue: 'Status' })}>
          <select className={inputCls} value={status} onChange={(e) => set('status', e.target.value)}>
            <option value="">{t('accounting.all', { defaultValue: 'All' })}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{t(`accounting.status_${s}`, { defaultValue: s[0]!.toUpperCase() + s.slice(1) })}</option>
            ))}
          </select>
        </Field>
        <Field label={t('accounting.from', { defaultValue: 'From' })}>
          <DateField className={inputCls} value={from} onChange={(e) => set('from', e.target.value)} />
        </Field>
        <Field label={t('accounting.to', { defaultValue: 'To' })}>
          <DateField className={inputCls} value={to} onChange={(e) => set('to', e.target.value)} />
        </Field>
        <Field label={t('accounting.col_source', { defaultValue: 'Source' })}>
          <input className={inputCls} placeholder={t('accounting.source_ph', { defaultValue: 'e.g. sales_invoice' })} value={source} onChange={(e) => set('source', e.target.value)} />
        </Field>
        {filtered && (
          <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>
            {t('accounting.clear_filters', { defaultValue: 'Clear filters' })}
          </Button>
        )}
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={() => refetch()} />
      ) : data && data.length === 0 ? (
        <EmptyBlock
          title={filtered ? t('accounting.entries_none_filtered', { defaultValue: 'No entries match these filters' }) : t('accounting.entries_empty', { defaultValue: 'No journal entries yet' })}
          hint={filtered ? undefined : t('accounting.entries_empty_hint', { defaultValue: 'Entries from sales appear here automatically. You can also record one by hand.' })}
          action={
            filtered ? undefined : (
              <Button size="sm" onClick={() => navigate('/accounting/journal/new')}>
                <Plus className="mr-1 h-4 w-4" />
                {t('accounting.new_entry', { defaultValue: 'New entry' })}
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-light bg-surface-elevated shadow-xs">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-content-tertiary">
              <tr>
                <th className={thCls}>{t('accounting.col_number', { defaultValue: 'Number' })}</th>
                <th className={thCls}>{t('accounting.col_date', { defaultValue: 'Date' })}</th>
                <th className={thCls}>{t('accounting.col_memo', { defaultValue: 'Memo' })}</th>
                <th className={thCls}>{t('accounting.col_source', { defaultValue: 'Source' })}</th>
                <th className={thCls}>{t('accounting.col_status', { defaultValue: 'Status' })}</th>
                <th className={thCls + ' text-right'}>{t('accounting.col_amount', { defaultValue: 'Amount' })}</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((e) => (
                <tr key={e.id} className="border-t border-border-light hover:bg-surface-secondary">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link to={`/accounting/journal/${e.id}`} className="text-content-primary hover:underline">
                      {e.number ?? t('accounting.draft_no_number', { defaultValue: 'Draft' })}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-content-secondary">{e.entry_date}</td>
                  <td className="max-w-xs truncate px-4 py-2 text-content-primary">{e.memo || '—'}</td>
                  <td className="px-4 py-2 text-content-secondary"><SourceChip source={e.source_type} /></td>
                  <td className="px-4 py-2">
                    <Badge size="sm" variant={STATUS_VARIANT[e.status] ?? 'neutral'}>
                      {t(`accounting.status_${e.status}`, { defaultValue: e.status })}
                    </Badge>
                  </td>
                  <td className={numCls}>{fmtMoney(e.lines.reduce((s, l) => s + toCents(l.debit), 0) / 100, e.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AccountingShell>
  );
}
