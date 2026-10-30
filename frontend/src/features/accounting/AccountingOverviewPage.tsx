import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BookOpen, FileBarChart, ListTree } from 'lucide-react';
import { fmtMoney } from '@/features/sales/api';
import { Badge } from '@/shared/ui/Badge';
import { glApi, presetRange, useBusinessCurrency } from './api';
import { PeriodPicker } from './PeriodPicker';
import { AccountingShell, ErrorBlock } from './ui';

function Kpi({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <div className="rounded-md border border-border-light bg-surface-primary p-4">
      <p className="text-xs text-content-tertiary">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-content-primary">{value ?? '—'}</p>
      {hint && <p className="mt-1 text-xs text-content-tertiary">{hint}</p>}
    </div>
  );
}

export function AccountingOverviewPage() {
  const { t } = useTranslation();
  const currency = useBusinessCurrency();
  const [range, setRange] = useState(() => presetRange('month'));
  const pl = useQuery({ queryKey: ['gl', 'pl', range.from, range.to], queryFn: () => glApi.profitLoss(range.from, range.to), retry: false });
  const bs = useQuery({ queryKey: ['gl', 'bs', range.to], queryFn: () => glApi.balanceSheet(range.to), retry: false, enabled: !!range.to });
  const drafts = useQuery({ queryKey: ['gl', 'entries', { status: 'draft' }], queryFn: () => glApi.entries({ status: 'draft' }), retry: false });
  const kpis = useQuery({ queryKey: ['gl', 'kpis'], queryFn: () => glApi.kpis(), retry: false });
  const m = (v?: string) => (v == null ? null : fmtMoney(v, currency));
  const qs = `?from=${range.from}&to=${range.to}`;
  const failed = pl.error && bs.error;

  const links = [
    { to: '/accounting/accounts', icon: ListTree, title: t('accounting.tab_accounts', { defaultValue: 'Chart of accounts' }), hint: t('accounting.link_accounts', { defaultValue: 'Accounts by class, with balances' }) },
    { to: '/accounting/journal', icon: BookOpen, title: t('accounting.tab_journal', { defaultValue: 'Journal' }), hint: t('accounting.link_journal', { defaultValue: 'Entries, drafts and reversals' }) },
    { to: `/accounting/reports${qs}`, icon: FileBarChart, title: t('accounting.tab_reports', { defaultValue: 'Reports' }), hint: t('accounting.link_reports', { defaultValue: 'Trial balance, balance sheet, profit and loss, VAT' }) },
  ];

  return (
    <AccountingShell title={t('accounting.title', { defaultValue: 'Accounting' })}>
      <div>
        <PeriodPicker from={range.from} to={range.to} onChange={setRange} />
      </div>
      {failed ? (
        <ErrorBlock error={pl.error} onRetry={() => { pl.refetch(); bs.refetch(); }} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label={t('accounting.kpi_income', { defaultValue: 'Income' })} value={m(pl.data?.income.total)} />
          <Kpi label={t('accounting.kpi_expense', { defaultValue: 'Expenses' })} value={m(pl.data?.expense.total)} />
          <Kpi label={t('accounting.kpi_net', { defaultValue: 'Net income' })} value={m(pl.data?.net_income)} />
          <Kpi
            label={t('accounting.kpi_assets', { defaultValue: 'Total assets' })}
            value={m(bs.data?.total_assets)}
            hint={bs.data && !bs.data.balanced ? t('accounting.not_balanced', { defaultValue: 'Assets and liabilities + equity differ' }) : undefined}
          />
        </div>
      )}
      {kpis.data && (
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Kpi label={t('accounting.kpi_revenue_ytd', { defaultValue: 'Revenue, year to date' })} value={m(kpis.data.revenue_ytd)} />
          <Kpi label={t('accounting.kpi_net_ytd', { defaultValue: 'Net income, year to date' })} value={m(kpis.data.net_income_ytd)} />
          <Kpi label={t('accounting.kpi_net_mtd', { defaultValue: 'Net income, this month' })} value={m(kpis.data.net_income_mtd)} />
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 text-sm text-content-secondary">
        {drafts.data && drafts.data.length > 0 ? (
          <>
            <Badge size="sm" variant="warning">{drafts.data.length}</Badge>
            <Link to="/accounting/journal?status=draft" className="hover:underline">
              {t('accounting.drafts_waiting', { defaultValue: 'draft entries waiting to be posted' })}
            </Link>
          </>
        ) : (
          drafts.data && <span>{t('accounting.no_drafts', { defaultValue: 'No draft entries waiting.' })}</span>
        )}
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="flex items-start gap-3 rounded-md border border-border-light bg-surface-primary p-4 hover:bg-surface-secondary">
            <l.icon className="mt-0.5 h-4 w-4 text-content-tertiary" aria-hidden />
            <span>
              <span className="block text-sm font-medium text-content-primary">{l.title}</span>
              <span className="block text-xs text-content-secondary">{l.hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </AccountingShell>
  );
}
