import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { CalendarDays, Search } from 'lucide-react';
import { Badge, Card, EmptyState, SkeletonTable } from '@/shared/ui';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { STATUSES, STATUS_LABEL, STATUS_VARIANT, parseLocal, type Booking, type Resource, type Service } from '../api';
import { useClientLabel } from '../clientLabel';
import { inputCls } from './CalendarToolbar';

export type ListFilter = '' | Booking['status'] | 'to_invoice';
export type ListRange = 'upcoming' | 'past';

interface Props {
  bookings: Booking[];
  services: Service[];
  resources: Resource[];
  loading: boolean;
  error: boolean;
  filter: ListFilter;
  range: ListRange;
  onFilter: (f: ListFilter) => void;
  onRange: (r: ListRange) => void;
  onRetry: () => void;
  onOpen: (b: Booking) => void;
}

const th = 'px-4 py-2.5 text-left';
const td = 'px-4 py-2';

/** Pure filter used by the list (exported for tests). */
export function filterBookings(rows: Booking[], filter: ListFilter, query: string): Booking[] {
  const q = query.trim().toLowerCase();
  return rows.filter((b) => {
    if (filter === 'to_invoice' ? !(b.status === 'completed' && !b.invoice_id) : filter && b.status !== filter) return false;
    if (!q) return true;
    return [b.client_name, b.client_email, b.client_phone].some((v) => v.toLowerCase().includes(q));
  });
}

export function BookingList(p: Props) {
  const { t, i18n } = useTranslation();
  const clientLabel = useClientLabel();
  const [query, setQuery] = useState('');
  const service = useMemo(() => new Map(p.services.map((s) => [s.id, s])), [p.services]);
  const resourceName = useMemo(() => new Map(p.resources.map((r) => [r.id, r.name])), [p.resources]);
  const rows = useMemo(() => {
    const out = filterBookings(p.bookings, p.filter, query);
    return p.range === 'past' ? [...out].reverse() : out;
  }, [p.bookings, p.filter, p.range, query]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary" />
          <input
            className={clsx(inputCls, 'pl-8')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('appointments.search_bookings', { defaultValue: 'Search name, email or phone' })}
            aria-label={t('appointments.search_bookings', { defaultValue: 'Search name, email or phone' })}
          />
        </div>
        <select className={clsx(inputCls, 'max-w-[220px]')} value={p.filter} onChange={(e) => p.onFilter(e.target.value as ListFilter)} aria-label={t('appointments.status', { defaultValue: 'Status' })}>
          <option value="">{t('appointments.all_statuses', { defaultValue: 'All statuses' })}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`appointments.status_${s}`, { defaultValue: STATUS_LABEL[s] })}</option>
          ))}
          <option value="to_invoice">{t('appointments.filter_to_invoice', { defaultValue: 'Done, not invoiced' })}</option>
        </select>
        <div className="inline-flex rounded-lg border border-border p-0.5" role="group">
          {(['upcoming', 'past'] as const).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={p.range === r}
              onClick={() => p.onRange(r)}
              className={clsx('rounded-md px-3 py-1 text-xs font-medium', p.range === r ? 'bg-oe-blue text-content-inverse' : 'text-content-secondary')}
            >
              {r === 'upcoming'
                ? t('appointments.next_60_days', { defaultValue: 'Next 60 days' })
                : t('appointments.last_60_days', { defaultValue: 'Last 60 days' })}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-content-tertiary">{t('appointments.count_bookings', { defaultValue: '{{count}} bookings', count: rows.length })}</span>
      </div>
      <Card padding="none">
        {p.loading ? (
          <div className="p-4"><SkeletonTable rows={8} columns={6} /></div>
        ) : p.error ? (
          <EmptyState
            icon={<CalendarDays size={22} />}
            title={t('appointments.load_error', { defaultValue: 'Could not load bookings' })}
            action={{ label: t('common.retry', { defaultValue: 'Retry' }), onClick: p.onRetry }}
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={<CalendarDays size={22} />} title={t('appointments.empty', { defaultValue: 'No bookings in this period.' })} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary text-xs uppercase tracking-wide text-content-tertiary">
                <tr>
                  <th className={th}>{t('appointments.when', { defaultValue: 'When' })}</th>
                  <th className={th}>{clientLabel}</th>
                  <th className={th}>{t('appointments.service', { defaultValue: 'Service' })}</th>
                  <th className={th}>{t('appointments.resource', { defaultValue: 'Resource' })}</th>
                  <th className={clsx(th, 'text-right')}>{t('appointments.price', { defaultValue: 'Price' })}</th>
                  <th className={th}>{t('appointments.status', { defaultValue: 'Status' })}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const svc = service.get(b.service_id);
                  return (
                    <tr
                      key={b.id}
                      tabIndex={0}
                      className="cursor-pointer border-t border-border-light hover:bg-surface-secondary focus:bg-surface-secondary focus:outline-none"
                      onClick={() => p.onOpen(b)}
                      onKeyDown={(e) => e.key === 'Enter' && p.onOpen(b)}
                    >
                      <td className={clsx(td, 'whitespace-nowrap tabular-nums')}>
                        {parseLocal(b.start_at).toLocaleString(i18n.language, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className={td}>
                        <span className="font-medium text-content-primary">{b.client_name}</span>
                        {b.client_email && <span className="block text-2xs text-content-tertiary">{b.client_email}</span>}
                      </td>
                      <td className={clsx(td, 'text-content-secondary')}>{svc?.name ?? ''}</td>
                      <td className={clsx(td, 'text-content-secondary')}>{resourceName.get(b.resource_id) ?? ''}</td>
                      <td className={clsx(td, 'text-right')}>{svc ? <MoneyDisplay amount={svc.price} currency={svc.currency} /> : null}</td>
                      <td className={clsx(td, 'whitespace-nowrap')}>
                        <Badge variant={STATUS_VARIANT[b.status]} size="sm">{t(`appointments.status_${b.status}`, { defaultValue: STATUS_LABEL[b.status] })}</Badge>
                        {b.source === 'online' && <Badge variant="neutral" size="sm" className="ml-1">{t('appointments.source_online', { defaultValue: 'Online' })}</Badge>}
                        {b.invoice_id && <Badge variant="success" size="sm" className="ml-1">{t('appointments.invoiced', { defaultValue: 'Invoiced' })}</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
