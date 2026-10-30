import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { fmtMoney } from '@/features/sales/api';
import { triggerDownload } from '@/shared/lib/api';
import { Button } from '@/shared/ui/Button';
import { glApi, toCsv, toCents, useBusinessCurrency } from './api';
import { PeriodPicker } from './PeriodPicker';
import { AccountingShell, EmptyBlock, ErrorBlock, LoadingBlock, numCls, thCls } from './ui';

export function AccountLedgerPage() {
  const { t } = useTranslation();
  const currency = useBusinessCurrency();
  const { accountId = '' } = useParams<{ accountId: string }>();
  const [params, setParams] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['gl', 'ledger', accountId, from, to],
    queryFn: () => glApi.ledger(accountId, from || undefined, to || undefined),
    enabled: !!accountId,
    retry: false,
  });
  const m = (v: string) => (toCents(v) ? fmtMoney(v, currency) : '');

  const exportCsv = () => {
    if (!data) return;
    triggerDownload(
      new Blob(
        [toCsv([
          ['Date', 'Entry', 'Memo', 'Debit', 'Credit', 'Balance'],
          ['', '', 'Opening balance', '', '', Number(data.opening)],
          ...data.rows.map((r) => [r.entry_date, r.number ?? '', r.description || r.memo, Number(r.debit), Number(r.credit), Number(r.balance)]),
        ])],
        { type: 'text/csv;charset=utf-8' },
      ),
      `ledger-${data.code}.csv`,
    );
  };

  return (
    <AccountingShell
      parent={{ label: t('accounting.tab_reports', { defaultValue: 'Reports' }), to: '/accounting/reports' }}
      title={data ? `${data.code} ${data.name}` : t('accounting.ledger', { defaultValue: 'Account ledger' })}
      actions={
        <Button size="sm" variant="secondary" icon={<Download size={14} />} disabled={!data || data.rows.length === 0} onClick={exportCsv}>
          {t('accounting.export_csv', { defaultValue: 'Export CSV' })}
        </Button>
      }
    >
      <div>
        <PeriodPicker
          from={from}
          to={to}
          onChange={(r) => {
            const p = new URLSearchParams();
            if (r.from) p.set('from', r.from);
            if (r.to) p.set('to', r.to);
            setParams(p, { replace: true });
          }}
        />
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={() => refetch()} />
      ) : data && data.rows.length === 0 ? (
        <EmptyBlock title={t('accounting.ledger_empty', { defaultValue: 'No postings on this account in this period' })} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-light bg-surface-elevated shadow-xs">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-content-tertiary">
              <tr>
                <th className={thCls}>{t('accounting.col_date', { defaultValue: 'Date' })}</th>
                <th className={thCls}>{t('accounting.col_number', { defaultValue: 'Number' })}</th>
                <th className={thCls}>{t('accounting.col_memo', { defaultValue: 'Memo' })}</th>
                <th className={thCls + ' text-right'}>{t('accounting.col_debit', { defaultValue: 'Debit' })}</th>
                <th className={thCls + ' text-right'}>{t('accounting.col_credit', { defaultValue: 'Credit' })}</th>
                <th className={thCls + ' text-right'}>{t('accounting.col_balance', { defaultValue: 'Balance' })}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-surface-secondary/50">
                <td colSpan={5} className="px-4 py-2 text-content-secondary">{t('accounting.opening_balance', { defaultValue: 'Opening balance' })}</td>
                <td className={numCls}>{fmtMoney(data?.opening ?? 0, currency)}</td>
              </tr>
              {data?.rows.map((r, i) => (
                <tr key={`${r.entry_id}-${i}`} className="border-t border-border-light hover:bg-surface-secondary">
                  <td className="px-4 py-2 text-content-secondary">{r.entry_date}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link to={`/accounting/journal/${r.entry_id}`} className="text-content-primary hover:underline">{r.number ?? '—'}</Link>
                  </td>
                  <td className="max-w-xs truncate px-4 py-2 text-content-primary">{r.description || r.memo || '—'}</td>
                  <td className={numCls}>{m(r.debit)}</td>
                  <td className={numCls}>{m(r.credit)}</td>
                  <td className={numCls}>{fmtMoney(r.balance, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border-light bg-surface-secondary font-semibold">
              <tr>
                <td colSpan={5} className="px-4 py-2">{t('accounting.closing_balance', { defaultValue: 'Closing balance' })}</td>
                <td className={numCls}>{fmtMoney(data?.closing ?? 0, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </AccountingShell>
  );
}
