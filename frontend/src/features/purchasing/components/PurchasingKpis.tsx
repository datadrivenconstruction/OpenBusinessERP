import { useTranslation } from 'react-i18next';
import { AlertTriangle, CalendarClock, PackageOpen, ShoppingCart } from 'lucide-react';
import { KpiBand, type KpiBandItem } from '@/shared/ui/KpiBand';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { usePurchasingStats } from '../hooks';

/** Four headline tiles; each one jumps to the matching pre-filtered list. */
export function PurchasingKpis({ onJump }: { onJump: (tab: 'orders' | 'bills', patch: Record<string, string>) => void }) {
  const { t } = useTranslation();
  const { data: s, isError } = usePurchasingStats();
  if (isError) return null;
  const cur = s?.currency;
  const v = (n: number | undefined) => (s ? n : '—');
  const items: KpiBandItem[] = [
    {
      key: 'open_po',
      icon: ShoppingCart,
      tone: 'blue',
      label: t('purchasing.kpi_open_po', { defaultValue: 'Open purchase orders' }),
      value: v(s?.open_po_count),
      sub: s ? <MoneyDisplay amount={s.open_po_value} currency={cur} /> : null,
      onClick: () => onJump('orders', { status: 'confirmed,partially_received' }),
    },
    {
      key: 'to_receive',
      icon: PackageOpen,
      tone: 'warning',
      label: t('purchasing.kpi_to_receive', { defaultValue: 'To receive' }),
      value: v(s?.to_receive_count),
      sub: s ? <MoneyDisplay amount={s.to_receive_value} currency={cur} /> : null,
      onClick: () => onJump('orders', { status: 'confirmed,partially_received' }),
    },
    {
      key: 'due_week',
      icon: CalendarClock,
      tone: 'default',
      label: t('purchasing.kpi_due_week', { defaultValue: 'Bills to pay this week' }),
      value: v(s?.bills_due_week_count),
      sub: s ? <MoneyDisplay amount={s.bills_due_week_value} currency={cur} /> : null,
      onClick: () => onJump('bills', { status: 'posted,partially_paid', sort: 'due_date' }),
    },
    {
      key: 'overdue',
      icon: AlertTriangle,
      tone: s && s.overdue_count > 0 ? 'danger' : 'success',
      tintValue: !!s && s.overdue_count > 0,
      label: t('purchasing.kpi_overdue', { defaultValue: 'Overdue' }),
      value: v(s?.overdue_count),
      sub: s ? <MoneyDisplay amount={s.overdue_value} currency={cur} /> : null,
      onClick: () => onJump('bills', { overdue: '1' }),
    },
  ];
  return <KpiBand items={items} columns={4} size="sm" />;
}
