import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { Download } from 'lucide-react';
import { ComplianceDisclaimer } from '@/shared/ui/ComplianceDisclaimer';
import { fmtMoney } from '@/features/sales/api';
import { triggerDownload } from '@/shared/lib/api';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import {
  glApi, presetRange, previousRange, toCsv, useBusinessCurrency,
  type BalanceSheet, type ProfitLoss, type Section, type TrialBalance, type VatReport,
} from './api';
import { PeriodPicker } from './PeriodPicker';
import { AccountingShell, EmptyBlock, ErrorBlock, LoadingBlock, numCls, thCls } from './ui';

type Tab = 'trial' | 'balance' | 'pnl' | 'vat';
const TABS: Tab[] = ['trial', 'balance', 'pnl', 'vat'];
const TAB_LABEL: Record<Tab, string> = { trial: 'Trial balance', balance: 'Balance sheet', pnl: 'Profit and loss', vat: 'VAT return' };

export interface ReportRow {
  kind: 'head' | 'acc' | 'total';
  label: string;
  code?: string;
  accountId?: string;
  cur?: number;
  prev?: number;
}

const n = (v: string | number | undefined) => Number(v) || 0;

function sectionRows(label: string, totalLabel: string, cur: Section | undefined, prev: Section | undefined): ReportRow[] {
  const ids = new Map<string, { code: string; name: string }>();
  for (const a of [...(cur?.accounts ?? []), ...(prev?.accounts ?? [])]) ids.set(a.account_id, { code: a.code, name: a.name });
  const c = new Map((cur?.accounts ?? []).map((a) => [a.account_id, n(a.balance)]));
  const p = new Map((prev?.accounts ?? []).map((a) => [a.account_id, n(a.balance)]));
  const accs = [...ids.entries()]
    .sort((a, b) => a[1].code.localeCompare(b[1].code, undefined, { numeric: true }))
    .map(([id, v]): ReportRow => ({ kind: 'acc', label: v.name, code: v.code, accountId: id, cur: c.get(id) ?? 0, prev: p.get(id) ?? 0 }));
  return [
    { kind: 'head', label },
    ...accs,
    { kind: 'total', label: totalLabel, cur: n(cur?.total), prev: n(prev?.total) },
  ];
}

export function pnlRows(cur?: ProfitLoss, prev?: ProfitLoss, L = (_k: string, d: string) => d): ReportRow[] {
  return [
    ...sectionRows(L('accounting.type_income', 'Income'), L('accounting.total_income', 'Total income'), cur?.income, prev?.income),
    ...sectionRows(L('accounting.type_expense', 'Expenses'), L('accounting.total_expense', 'Total expenses'), cur?.expense, prev?.expense),
    { kind: 'total', label: L('accounting.net_income', 'Net income'), cur: n(cur?.net_income), prev: n(prev?.net_income) },
  ];
}

export function balanceRows(cur?: BalanceSheet, prev?: BalanceSheet, L = (_k: string, d: string) => d): ReportRow[] {
  return [
    ...sectionRows(L('accounting.type_asset', 'Assets'), L('accounting.total_asset', 'Total assets'), cur?.asset, prev?.asset),
    ...sectionRows(L('accounting.type_liability', 'Liabilities'), L('accounting.total_liability', 'Total liabilities'), cur?.liability, prev?.liability),
    ...sectionRows(L('accounting.type_equity', 'Equity'), L('accounting.total_equity', 'Total equity'), cur?.equity, prev?.equity),
    { kind: 'acc', label: L('accounting.unclosed_earnings', 'Current-period earnings'), cur: n(cur?.unclosed_earnings), prev: n(prev?.unclosed_earnings) },
    { kind: 'total', label: L('accounting.total_assets', 'Total assets'), cur: n(cur?.total_assets), prev: n(prev?.total_assets) },
    { kind: 'total', label: L('accounting.total_le', 'Total liabilities and equity'), cur: n(cur?.total_liabilities_equity), prev: n(prev?.total_liabilities_equity) },
  ];
}

export function ReportsPage() {
  const { t } = useTranslation();
  const currency = useBusinessCurrency();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'trial') as Tab;
  const def = useMemo(() => presetRange('year'), []);
  const from = params.get('from') || def.from;
  const to = params.get('to') || def.to;
  const compare = params.get('compare') !== '0' && tab !== 'trial' && tab !== 'vat';
  const prev = previousRange(from, to);
  const L = (k: string, d: string) => t(k, { defaultValue: d });

  const update = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v == null ? p.delete(k) : p.set(k, v));
    setParams(p, { replace: true });
  };

  const trial = useQuery({ queryKey: ['gl', 'tb', from, to], queryFn: () => glApi.trialBalance(from, to), enabled: tab === 'trial', retry: false });
  const pnl = useQuery({ queryKey: ['gl', 'pl', from, to], queryFn: () => glApi.profitLoss(from, to), enabled: tab === 'pnl', retry: false });
  const pnlPrev = useQuery({ queryKey: ['gl', 'pl', prev.from, prev.to], queryFn: () => glApi.profitLoss(prev.from, prev.to), enabled: tab === 'pnl' && compare, retry: false });
  const bs = useQuery({ queryKey: ['gl', 'bs', to], queryFn: () => glApi.balanceSheet(to), enabled: tab === 'balance', retry: false });
  const bsPrev = useQuery({ queryKey: ['gl', 'bs', prev.to], queryFn: () => glApi.balanceSheet(prev.to), enabled: tab === 'balance' && compare, retry: false });

  const vat = useQuery({ queryKey: ['gl', 'vat', from, to], queryFn: () => glApi.vatReport(from, to), enabled: tab === 'vat', retry: false });
  const active = tab === 'trial' ? trial : tab === 'pnl' ? pnl : tab === 'vat' ? vat : bs;
  const prevQ = tab === 'pnl' ? pnlPrev : bsPrev;
  const rows = tab === 'pnl' ? pnlRows(pnl.data, compare ? pnlPrev.data : undefined, L) : tab === 'balance' ? balanceRows(bs.data, compare ? bsPrev.data : undefined, L) : [];
  const curLabel = tab === 'balance' ? to : `${from} – ${to}`;
  const prevLabel = tab === 'balance' ? prev.to : `${prev.from} – ${prev.to}`;
  const ledgerQs = tab === 'balance' ? `?to=${to}` : `?from=${from}&to=${to}`;

  const exportCsv = () => {
    let data: (string | number)[][];
    if (tab === 'vat') {
      const v = vat.data;
      data = [
        ['Code', 'Account', 'Debit', 'Credit'],
        ...[...(v?.output_accounts ?? []), ...(v?.input_accounts ?? [])].map((a) => [a.code, a.name, n(a.debit), n(a.credit)]),
        ['', 'Output VAT', n(v?.output_vat), ''],
        ['', 'Input VAT', n(v?.input_vat), ''],
        ['', 'Net payable', n(v?.net_payable), ''],
      ];
    } else if (tab === 'trial') {
      const rs = trial.data?.rows ?? [];
      data = [
        ['Code', 'Account', 'Opening', 'Debit', 'Credit', 'Closing'],
        ...rs.map((r) => [r.code, r.name, n(r.opening), n(r.debit), n(r.credit), n(r.closing)]),
        ['', 'Total', '', n(trial.data?.total_debit), n(trial.data?.total_credit), ''],
      ];
    } else {
      data = [
        ['Code', 'Line', curLabel, ...(compare ? [prevLabel] : [])],
        ...rows.filter((r) => r.kind !== 'head').map((r) => [r.code ?? '', r.label, r.cur ?? 0, ...(compare ? [r.prev ?? 0] : [])]),
      ];
    }
    triggerDownload(new Blob([toCsv(data)], { type: 'text/csv;charset=utf-8' }), `${tab === 'vat' ? 'vat-return' : tab === 'trial' ? 'trial-balance' : tab === 'pnl' ? 'profit-and-loss' : 'balance-sheet'}-${to}.csv`);
  };

  const money = (v?: number) => (v == null ? '' : fmtMoney(v, currency));
  const ready = !active.isLoading && !active.error;
  const empty = ready && (tab === 'vat' ? !vat.data || (vat.data.output_accounts.length + vat.data.input_accounts.length === 0) : tab === 'trial' ? (trial.data?.rows.length ?? 0) === 0 : rows.every((r) => r.kind !== 'acc' || (!r.cur && !r.prev)));
  const unbalanced = tab === 'trial' ? trial.data && !trial.data.balanced : tab === 'balance' ? bs.data && !bs.data.balanced : false;

  return (
    <AccountingShell
      title={t('accounting.tab_reports', { defaultValue: 'Reports' })}
      actions={
        <Button size="sm" variant="secondary" icon={<Download size={14} />} disabled={!ready || empty} onClick={exportCsv}>
          {t('accounting.export_csv', { defaultValue: 'Export CSV' })}
        </Button>
      }
    >
      <div role="tablist" className="flex gap-1">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={k === tab}
            type="button"
            onClick={() => update({ tab: k })}
            className={clsx('rounded px-4 py-2 text-sm', k === tab ? 'bg-surface-secondary font-medium text-content-primary' : 'text-content-secondary hover:text-content-primary')}
          >
            {t(`accounting.report_${k}`, { defaultValue: TAB_LABEL[k] })}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <PeriodPicker from={from} to={to} single={tab === 'balance'} onChange={(r) => update({ from: r.from, to: r.to })} />
        {tab !== 'trial' && (
          <label className="mb-1 flex items-center gap-2 text-sm text-content-primary">
            <input type="checkbox" checked={compare} onChange={(e) => update({ compare: e.target.checked ? null : '0' })} />
            {t('accounting.compare_previous', { defaultValue: 'Compare with previous period' })}
          </label>
        )}
        {unbalanced && <Badge variant="warning" size="sm">{t('accounting.not_balanced_short', { defaultValue: 'Does not balance' })}</Badge>}
      </div>

      {active.isLoading ? (
        <LoadingBlock />
      ) : active.error ? (
        <ErrorBlock error={active.error} onRetry={() => active.refetch()} />
      ) : empty ? (
        <EmptyBlock
          title={t('accounting.report_empty', { defaultValue: 'No postings in this period' })}
          hint={t('accounting.report_empty_hint', { defaultValue: 'Post journal entries, or pick a different period.' })}
        />
      ) : tab === 'vat' ? (
        <>
          <VatView data={vat.data!} money={money} qs={ledgerQs} />
          <ComplianceDisclaimer className="mt-3" />
        </>
      ) : tab === 'trial' ? (
        <TrialTable data={trial.data!} money={money} qs={ledgerQs} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-light bg-surface-elevated shadow-xs">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-content-tertiary">
              <tr>
                <th className={thCls}>{t('accounting.col_name', { defaultValue: 'Account' })}</th>
                <th className={thCls + ' text-right'}>{curLabel}</th>
                {compare && <th className={thCls + ' text-right'}>{prevQ.isLoading ? '…' : prevLabel}</th>}
                {compare && <th className={thCls + ' text-right'}>{t('accounting.col_change', { defaultValue: 'Change' })}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={clsx(r.kind !== 'acc' && 'bg-surface-secondary/50', r.kind === 'head' ? 'border-t border-border-light' : r.kind === 'total' ? 'border-t border-border-light font-semibold' : 'border-t border-border-light')}>
                  <td className={clsx('px-4 py-2', r.kind === 'head' ? 'text-xs font-semibold uppercase tracking-wide text-content-secondary' : 'text-content-primary', r.kind === 'acc' && 'pl-6')}>
                    {r.accountId ? (
                      <Link to={`/accounting/ledger/${r.accountId}${ledgerQs}`} className="hover:underline">
                        <span className="mr-2 font-mono text-xs text-content-tertiary">{r.code}</span>
                        {r.label}
                      </Link>
                    ) : (
                      r.label
                    )}
                  </td>
                  {r.kind === 'head' ? (
                    <td colSpan={compare ? 3 : 1} />
                  ) : (
                    <>
                      <td className={numCls}>{money(r.cur)}</td>
                      {compare && <td className={numCls + ' text-content-secondary'}>{money(r.prev)}</td>}
                      {compare && <td className={numCls + ' text-content-secondary'}>{money((r.cur ?? 0) - (r.prev ?? 0))}</td>}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AccountingShell>
  );
}

function TrialTable({ data, money, qs }: { data: TrialBalance; money: (v?: number) => string; qs: string }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-xl border border-border-light bg-surface-elevated shadow-xs">
      <table className="w-full text-sm">
        <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-content-tertiary">
          <tr>
            <th className={thCls}>{t('accounting.col_code', { defaultValue: 'Code' })}</th>
            <th className={thCls}>{t('accounting.col_name', { defaultValue: 'Account' })}</th>
            <th className={thCls + ' text-right'}>{t('accounting.col_opening', { defaultValue: 'Opening' })}</th>
            <th className={thCls + ' text-right'}>{t('accounting.col_debit', { defaultValue: 'Debit' })}</th>
            <th className={thCls + ' text-right'}>{t('accounting.col_credit', { defaultValue: 'Credit' })}</th>
            <th className={thCls + ' text-right'}>{t('accounting.col_closing', { defaultValue: 'Closing' })}</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.account_id} className="border-t border-border-light hover:bg-surface-secondary">
              <td className="px-4 py-2 font-mono text-xs text-content-secondary">{r.code}</td>
              <td className="px-4 py-2">
                <Link to={`/accounting/ledger/${r.account_id}${qs}`} className="text-content-primary hover:underline">{r.name}</Link>
              </td>
              <td className={numCls}>{money(n(r.opening))}</td>
              <td className={numCls}>{money(n(r.debit))}</td>
              <td className={numCls}>{money(n(r.credit))}</td>
              <td className={numCls}>{money(n(r.closing))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border-light bg-surface-secondary font-semibold">
          <tr>
            <td colSpan={3} className="px-4 py-2">{t('accounting.total', { defaultValue: 'Total' })}</td>
            <td className={numCls}>{money(n(data.total_debit))}</td>
            <td className={numCls}>{money(n(data.total_credit))}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function VatView({ data, money, qs }: { data: VatReport; money: (v?: number) => string; qs: string }) {
  const { t } = useTranslation();
  const net = n(data.net_payable);
  const tiles: [string, number, string?][] = [
    [t('accounting.vat_output', { defaultValue: 'Output VAT (sales)' }), n(data.output_vat)],
    [t('accounting.vat_input', { defaultValue: 'Input VAT (purchases)' }), n(data.input_vat)],
    [net >= 0 ? t('accounting.vat_payable', { defaultValue: 'Payable to tax office' }) : t('accounting.vat_refund', { defaultValue: 'Refund due' }), Math.abs(net), net >= 0 ? 'text-semantic-error' : 'text-semantic-success'],
  ];
  const block = (title: string, rows: VatReport['output_accounts']) => (
    <div className="overflow-x-auto rounded-xl border border-border-light bg-surface-elevated shadow-xs">
      <table className="w-full text-sm">
        <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-content-tertiary">
          <tr>
            <th className={thCls}>{title}</th>
            <th className={thCls + ' text-right'}>{t('accounting.col_debit', { defaultValue: 'Debit' })}</th>
            <th className={thCls + ' text-right'}>{t('accounting.col_credit', { defaultValue: 'Credit' })}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={3} className="px-4 py-3 text-content-tertiary">{t('accounting.vat_no_account', { defaultValue: 'No VAT account mapped. Set it in Sales / Purchasing account mapping.' })}</td></tr>
          )}
          {rows.map((a) => (
            <tr key={a.account_id} className="border-t border-border-light hover:bg-surface-secondary">
              <td className="px-4 py-2">
                <Link to={`/accounting/ledger/${a.account_id}${qs}`} className="text-content-primary hover:underline">
                  <span className="mr-2 font-mono text-xs text-content-tertiary">{a.code}</span>{a.name}
                </Link>
              </td>
              <td className={numCls}>{money(n(a.debit))}</td>
              <td className={numCls}>{money(n(a.credit))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map(([label, v, cls]) => (
          <div key={label} className="rounded-xl border border-border-light bg-surface-elevated p-4 shadow-xs">
            <div className="text-xs uppercase tracking-wide text-content-tertiary">{label}</div>
            <div className={clsx('mt-1 text-xl font-semibold tabular-nums', cls ?? 'text-content-primary')}>{money(v)}</div>
          </div>
        ))}
      </div>
      {block(t('accounting.vat_output_accounts', { defaultValue: 'Output VAT accounts' }), data.output_accounts)}
      {block(t('accounting.vat_input_accounts', { defaultValue: 'Input VAT accounts' }), data.input_accounts)}
    </div>
  );
}
