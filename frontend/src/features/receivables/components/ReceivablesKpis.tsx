/** Headline figures for the receivables page, built from the aging report and the open promise log. */
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CalendarClock, Handshake, Users, Wallet } from 'lucide-react';
import { KpiBand } from '@/shared/ui';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import type { Aging, FollowUp } from '../api';

interface Props {
  aging: Aging | undefined;
  promises: FollowUp[];
  currency: string;
  onOverdue: () => void;
  onSevere: () => void;
  onPromises: () => void;
}

export function ReceivablesKpis({ aging, promises, currency, onOverdue, onSevere, onPromises }: Props) {
  const { t } = useTranslation();
  const total = Number(aging?.totals.total ?? 0);
  const overdue = total - Number(aging?.totals.current ?? 0);
  const severe = Number(aging?.totals.d90_plus ?? 0);
  const overdueCustomers = (aging?.rows ?? []).filter((r) => Number(r.total) - Number(r.current) > 0).length;
  const brokenOrLate = promises.filter((p) => p.overdue).length;
  const promised = promises.reduce((s, p) => s + Number(p.promised_amount ?? 0), 0);

  return (
    <KpiBand
      columns={5}
      size="sm"
      items={[
        {
          key: 'open',
          label: t('receivables.kpi_open', { defaultValue: 'Open receivables' }),
          value: <MoneyDisplay amount={total} currency={currency} />,
          sub: t('receivables.kpi_customers', { defaultValue: '{{count}} customers', count: aging?.rows.length ?? 0 }),
          icon: Wallet,
          tone: 'blue',
        },
        {
          key: 'overdue',
          label: t('receivables.kpi_overdue', { defaultValue: 'Past due' }),
          value: <MoneyDisplay amount={overdue} currency={currency} />,
          sub: total ? `${Math.round((overdue / total) * 100)}%` : '—',
          icon: AlertTriangle,
          tone: overdue > 0 ? 'warning' : 'success',
          onClick: onOverdue,
        },
        {
          key: 'severe',
          label: t('receivables.kpi_severe', { defaultValue: 'Over 90 days' }),
          value: <MoneyDisplay amount={severe} currency={currency} />,
          icon: CalendarClock,
          tone: severe > 0 ? 'danger' : 'default',
          tintValue: severe > 0,
          onClick: onSevere,
        },
        {
          key: 'customers',
          label: t('receivables.kpi_overdue_customers', { defaultValue: 'Customers past due' }),
          value: overdueCustomers,
          icon: Users,
        },
        {
          key: 'promises',
          label: t('receivables.kpi_promises', { defaultValue: 'Promised payments' }),
          value: <MoneyDisplay amount={promised} currency={currency} />,
          sub: brokenOrLate
            ? t('receivables.kpi_promises_late', { defaultValue: '{{count}} past the promised date', count: brokenOrLate })
            : t('receivables.kpi_promises_open', { defaultValue: '{{count}} open', count: promises.length }),
          icon: Handshake,
          tone: brokenOrLate ? 'warning' : 'default',
          onClick: onPromises,
        },
      ]}
    />
  );
}
