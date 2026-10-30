import { useTranslation } from 'react-i18next';
import { AlertTriangle, FileText, Receipt, ShoppingBag } from 'lucide-react';
import { KpiBand, MoneyDisplay } from '@/shared/ui';
import type { SalesStats } from '../api';

/** Pipeline KPIs; each tile jumps to the matching filtered list. */
export function SalesKpiStrip({
  stats,
  loading,
  onOpenQuotes,
  onOrdersToInvoice,
  onInvoices,
  onOverdue,
}: {
  stats: SalesStats | undefined;
  loading: boolean;
  onOpenQuotes: () => void;
  onOrdersToInvoice: () => void;
  onInvoices: () => void;
  onOverdue: () => void;
}) {
  const { t } = useTranslation();
  const cur = stats?.currency || 'EUR';
  const dash = loading ? '…' : '—';
  const money = (v: string | undefined) => (v != null ? <MoneyDisplay amount={v} currency={cur} compact /> : dash);
  return (
    <KpiBand
      columns={4}
      items={[
        {
          key: 'quotes',
          icon: FileText,
          tone: 'blue',
          label: t('sales.kpi.open_quotes', { defaultValue: 'Open quotes' }),
          value: money(stats?.open_quotes_value),
          sub:
            stats &&
            t('sales.kpi.open_quotes_sub', {
              defaultValue: '{{count}} quotes · win rate {{rate}}',
              count: stats.open_quotes_count,
              rate: stats.win_rate == null ? '—' : `${Math.round(stats.win_rate * (stats.win_rate <= 1 ? 100 : 1))}%`,
            }),
          onClick: onOpenQuotes,
        },
        {
          key: 'to_invoice',
          icon: ShoppingBag,
          tone: 'warning',
          label: t('sales.kpi.orders_to_invoice', { defaultValue: 'Orders to invoice' }),
          value: money(stats?.orders_to_invoice_value),
          sub: stats && t('sales.kpi.orders_sub', { defaultValue: '{{count}} orders', count: stats.orders_to_invoice_count }),
          onClick: onOrdersToInvoice,
        },
        {
          key: 'invoiced',
          icon: Receipt,
          tone: 'success',
          label: t('sales.kpi.invoiced_month', { defaultValue: 'Invoiced this month' }),
          value: money(stats?.invoiced_this_month),
          onClick: onInvoices,
        },
        {
          key: 'overdue',
          icon: AlertTriangle,
          tone: stats && stats.overdue_count > 0 ? 'danger' : 'default',
          tintValue: !!stats && stats.overdue_count > 0,
          label: t('sales.kpi.overdue', { defaultValue: 'Overdue' }),
          value: money(stats?.overdue_value),
          sub: stats && t('sales.kpi.overdue_sub', { defaultValue: '{{count}} invoices', count: stats.overdue_count }),
          onClick: onOverdue,
        },
      ]}
    />
  );
}
