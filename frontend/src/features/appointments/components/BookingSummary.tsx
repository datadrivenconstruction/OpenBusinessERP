import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BellRing, CalendarPlus, CheckCircle2, Clock, Globe, ReceiptText, Repeat, UserCheck, UserX } from 'lucide-react';
import { Badge, Button } from '@/shared/ui';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { useToastStore } from '@/stores/useToastStore';
import { getErrorMessage } from '@/shared/lib/api';
import { NEXT_STATUS, STATUS_LABEL, STATUS_VARIANT, appointmentsApi, parseLocal, type Booking, type BookingStatus, type Resource, type Service } from '../api';
import { icsEvent } from '../scheduling';
import { ReminderDraftModal } from '../modals/ReminderDraftModal';

interface Props {
  booking: Booking;
  service?: Service;
  resource?: Resource;
  onChange: (b: Booking) => void;
}

const STATUS_ICON: Partial<Record<BookingStatus, React.ElementType>> = {
  confirmed: CheckCircle2, checked_in: UserCheck, completed: CheckCircle2, no_show: UserX,
};

function downloadIcs(b: Booking, title: string) {
  const blob = new Blob([icsEvent({ uid: `${b.id}@appointments`, title, start: b.start_at, end: b.end_at, description: b.client_name })], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `appointment-${b.start_at.slice(0, 10)}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Status, timing, price and the follow-up actions of an existing booking. */
export function BookingSummary({ booking, service, resource, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [reminderId, setReminderId] = useState<string | null>(null);
  const fail = (e: unknown) => addToast({ type: 'error', title: getErrorMessage(e) });

  const move = useMutation({
    mutationFn: (s: BookingStatus) => appointmentsApi.setStatus(booking.id, s),
    onSuccess: (b) => {
      onChange(b);
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: fail,
  });
  const invoice = useMutation({
    mutationFn: () => appointmentsApi.createInvoice(booking.id),
    onSuccess: (r) => {
      onChange({ ...booking, invoice_id: r.invoice_id });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      addToast({ type: 'success', title: t('appointments.invoice_created', { defaultValue: 'Draft invoice {{number}} created', number: r.number }) });
    },
    onError: fail,
  });
  const reminder = useMutation({
    mutationFn: () => appointmentsApi.draftReminderFor(booking.id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['appointments', 'reminders'] });
      setReminderId(r.id);
    },
    onError: fail,
  });

  const start = parseLocal(booking.start_at);
  const end = parseLocal(booking.end_at);
  const past = end.getTime() < Date.now();
  const next = NEXT_STATUS[booking.status];
  const primary: BookingStatus | undefined =
    booking.status === 'requested' ? 'confirmed'
      : booking.status === 'confirmed' ? (past ? 'completed' : 'checked_in')
        : booking.status === 'checked_in' ? 'completed' : undefined;
  const upcoming = ['requested', 'confirmed'].includes(booking.status) && !past;

  return (
    <section className="mb-4 space-y-3 rounded-xl border border-border-light bg-surface-secondary/50 p-4" aria-label={t('appointments.booking_status', { defaultValue: 'Booking status' })}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[booking.status]}>{t(`appointments.status_${booking.status}`, { defaultValue: STATUS_LABEL[booking.status] })}</Badge>
        {booking.source === 'online' && <Badge variant="neutral" size="sm"><Globe size={10} className="mr-1 inline" />{t('appointments.source_online', { defaultValue: 'Online' })}</Badge>}
        {booking.series_id && <Badge variant="neutral" size="sm"><Repeat size={10} className="mr-1 inline" />{t('appointments.series', { defaultValue: 'Series' })}</Badge>}
        {booking.invoice_id && <Badge variant="success" size="sm">{t('appointments.invoiced', { defaultValue: 'Invoiced' })}</Badge>}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="col-span-2">
          <dt className="text-2xs uppercase tracking-wide text-content-tertiary">{t('appointments.when', { defaultValue: 'When' })}</dt>
          <dd className="flex items-center gap-1.5 font-medium">
            <Clock size={14} className="text-content-tertiary" />
            {start.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })},{' '}
            <span className="tabular-nums">{booking.start_at.slice(11, 16)}–{booking.end_at.slice(11, 16)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-2xs uppercase tracking-wide text-content-tertiary">{t('appointments.service', { defaultValue: 'Service' })}</dt>
          <dd>{service?.name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-2xs uppercase tracking-wide text-content-tertiary">{t('appointments.price', { defaultValue: 'Price' })}</dt>
          <dd>{service ? <MoneyDisplay amount={service.price} currency={service.currency} /> : '—'}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-2xs uppercase tracking-wide text-content-tertiary">{t('appointments.resource', { defaultValue: 'Resource' })}</dt>
          <dd>{resource?.name ?? '—'}</dd>
        </div>
      </dl>

      {next.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {primary && (
            <Button size="sm" variant="primary" onClick={() => move.mutate(primary)} disabled={move.isPending} icon={(() => { const I = STATUS_ICON[primary]; return I ? <I size={14} /> : undefined; })()}>
              {t(`appointments.to_${primary}`, { defaultValue: STATUS_LABEL[primary] })}
            </Button>
          )}
          {next.filter((s) => s !== primary).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === 'cancelled' ? 'ghost' : 'secondary'}
              onClick={() => move.mutate(s)}
              disabled={move.isPending}
              icon={s === 'no_show' ? <UserX size={14} /> : undefined}
              className={s === 'no_show' ? 'text-semantic-error' : undefined}
            >
              {t(`appointments.to_${s}`, { defaultValue: STATUS_LABEL[s] })}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border-light pt-3">
        {booking.status === 'completed' &&
          (booking.invoice_id ? (
            <Link to={`/sales/invoices/${booking.invoice_id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-oe-blue hover:underline">
              <ReceiptText size={14} />
              {t('appointments.open_invoice', { defaultValue: 'Open invoice' })}
            </Link>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => invoice.mutate()} disabled={invoice.isPending} icon={<ReceiptText size={14} />}>
              {t('appointments.create_invoice', { defaultValue: 'Create invoice' })}
            </Button>
          ))}
        {upcoming && booking.client_email && (
          <Button size="sm" variant="ghost" onClick={() => reminder.mutate()} disabled={reminder.isPending} icon={<BellRing size={14} />}>
            {t('appointments.prepare_reminder', { defaultValue: 'Prepare reminder' })}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => downloadIcs(booking, service?.name ?? '')} icon={<CalendarPlus size={14} />}>
          {t('appointments.add_to_calendar', { defaultValue: 'Calendar file (.ics)' })}
        </Button>
      </div>
      {booking.status === 'completed' && !booking.invoice_id && (
        <p className="text-2xs text-content-tertiary">
          {t('appointments.invoice_hint', { defaultValue: 'Creates a draft sales invoice with the service as one line. You can review it before sending.' })}
        </p>
      )}
      {reminderId && <ReminderDraftModal reminderId={reminderId} onClose={() => setReminderId(null)} />}
    </section>
  );
}
