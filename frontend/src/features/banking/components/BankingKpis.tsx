import { useTranslation } from 'react-i18next';
import { CheckCircle2, CircleDashed, Landmark, ListFilter, Wallet } from 'lucide-react';
import { KpiBand, MoneyDisplay, Skeleton } from '@/shared/ui';
import type { AccountSummary, BankingSummary } from '../api';

/** Bank-vs-ledger gap worth flagging (null when unmapped or below one cent). */
export function ledgerGap(a: Pick<AccountSummary, 'gl_difference'> | undefined): number | null {
  const d = a?.gl_difference == null ? NaN : Number(a.gl_difference);
  return Number.isFinite(d) && Math.abs(d) >= 0.005 ? d : null;
}

/** Currency most accounts use; mixed-currency totals are shown in it with a hint. */
export function mainCurrency(s: BankingSummary | undefined): string {
  const counts = new Map<string, number>();
  for (const a of s?.accounts ?? []) counts.set(a.currency, (counts.get(a.currency) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'EUR';
}

interface Props {
  summary: BankingSummary | undefined;
  loading: boolean;
  onOpenLines: () => void;
  onRules: () => void;
}

export function BankingKpis({ summary, loading, onOpenLines, onRules }: Props) {
  const { t } = useTranslation();
  if (loading && !summary) return <Skeleton className="h-[84px] w-full rounded-xl" />;
  const s = summary;
  const ccy = mainCurrency(s);
  const accounts = (s?.accounts ?? []).filter((a) => a.active);
  const sameCcy = accounts.filter((a) => a.currency === ccy);
  const balance = sameCcy.reduce((sum, a) => sum + Number(a.balance), 0);
  const mixed = sameCcy.length !== accounts.length;
  return (
    <KpiBand
      columns={5}
      items={[
        {
          key: 'balance',
          icon: Wallet,
          label: t('banking.kpi_balance', { defaultValue: 'Bank balance' }),
          value: <MoneyDisplay amount={balance} currency={ccy} />,
          sub: mixed
            ? t('banking.kpi_balance_mixed', { defaultValue: '{{ccy}} accounts only', ccy })
            : t('banking.kpi_balance_sub', { defaultValue: 'Opening balance + statement lines' }),
        },
        {
          key: 'accounts',
          icon: Landmark,
          label: t('banking.kpi_accounts', { defaultValue: 'Active accounts' }),
          value: accounts.length,
        },
        {
          key: 'open',
          icon: CircleDashed,
          tone: (s?.unmatched_count ?? 0) > 0 ? 'warning' : 'success',
          tintValue: true,
          label: t('banking.kpi_unmatched', { defaultValue: 'Lines to reconcile' }),
          value: s?.unmatched_count ?? 0,
          sub: <MoneyDisplay amount={s?.unmatched_amount ?? 0} currency={ccy} />,
          onClick: onOpenLines,
        },
        {
          key: 'matched',
          icon: CheckCircle2,
          tone: 'success',
          label: t('banking.kpi_matched_month', { defaultValue: 'Matched this month' }),
          value: s?.matched_this_month ?? 0,
          sub: <MoneyDisplay amount={s?.matched_amount_this_month ?? 0} currency={ccy} />,
        },
        {
          key: 'rules',
          icon: ListFilter,
          tone: 'blue',
          label: t('banking.kpi_rules', { defaultValue: 'Active rules' }),
          value: s?.active_rules ?? 0,
          sub: t('banking.kpi_rules_sub', { defaultValue: 'Auto-categorise fees and recurring payments' }),
          onClick: onRules,
        },
      ]}
    />
  );
}
