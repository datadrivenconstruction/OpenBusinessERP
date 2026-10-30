import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, CalendarDays, Inbox, ReceiptText, UserX, Wallet } from 'lucide-react';
import { KpiBand, type KpiBandItem } from '@/shared/ui/KpiBand';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import type { Booking, Service } from '../api';
import { bookingKpis } from '../scheduling';

interface Props {
  bookings: Booking[];
  services: Service[];
  onShowRequested: () => void;
  onShowToInvoice: () => void;
}

/** Headline strip: today, the week ahead, open requests, no-shows, booked value, unbilled work. */
export function AppointmentsKpis({ bookings, services, onShowRequested, onShowToInvoice }: Props) {
  const { t } = useTranslation();
  const k = useMemo(() => bookingKpis(bookings, services), [bookings, services]);
  const items: KpiBandItem[] = [
    { key: 'today', label: t('appointments.kpi_today', { defaultValue: 'Today' }), value: k.today, icon: CalendarDays, tone: 'blue' },
    {
      key: 'upcoming',
      label: t('appointments.kpi_upcoming', { defaultValue: 'Next 7 days' }),
      value: k.upcoming,
      icon: CalendarClock,
      sub: t('appointments.kpi_upcoming_sub', { defaultValue: 'open bookings' }),
    },
    {
      key: 'requested',
      label: t('appointments.kpi_requested', { defaultValue: 'Waiting for confirmation' }),
      value: k.requested,
      icon: Inbox,
      tone: k.requested > 0 ? 'warning' : 'default',
      onClick: k.requested > 0 ? onShowRequested : undefined,
    },
    {
      key: 'no_show',
      label: t('appointments.kpi_no_show', { defaultValue: 'No-show rate' }),
      value: k.noShowRate === null ? '—' : `${Math.round(k.noShowRate * 100)}%`,
      icon: UserX,
      tone: k.noShowRate !== null && k.noShowRate >= 0.1 ? 'danger' : 'default',
      sub: t('appointments.kpi_no_show_sub', { defaultValue: 'of finished bookings' }),
    },
    {
      key: 'value',
      label: t('appointments.kpi_value', { defaultValue: 'Booked value' }),
      value: <MoneyDisplay amount={k.bookedValue} currency={k.currency} compact />,
      icon: Wallet,
      tone: 'success',
    },
    {
      key: 'invoice',
      label: t('appointments.kpi_to_invoice', { defaultValue: 'Done, not invoiced' }),
      value: k.toInvoice,
      icon: ReceiptText,
      tone: k.toInvoice > 0 ? 'warning' : 'default',
      sub: k.toInvoice > 0 ? <MoneyDisplay amount={k.toInvoiceValue} currency={k.currency} /> : undefined,
      onClick: k.toInvoice > 0 ? onShowToInvoice : undefined,
    },
  ];
  return <KpiBand items={items} size="sm" />;
}
