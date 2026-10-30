import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CalendarPlus, CheckCircle2, Hourglass } from 'lucide-react';
import { parseLocal, type PublicBookingResult } from '../../api';
import { icsEvent } from '../../scheduling';

/** Shown after a successful public booking: summary, calendar file, manage link. */
export function PublicConfirmation({ result, title }: { result: PublicBookingResult; title: string }) {
  const { t, i18n } = useTranslation();
  const confirmed = result.status === 'confirmed';
  const manage = `${window.location.origin}/booking/${result.cancel_token}`;
  const ics = () => {
    const blob = new Blob(
      [icsEvent({ uid: `${result.cancel_token}@booking`, title: [result.service_name, title].filter(Boolean).join(' · '), start: result.start_at, end: result.end_at, description: manage })],
      { type: 'text/calendar' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'appointment.ics';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="text-center" role="status">
      {confirmed ? <CheckCircle2 size={44} className="mx-auto text-emerald-500" /> : <Hourglass size={44} className="mx-auto text-amber-500" />}
      <h1 className="mt-3 text-xl font-semibold">
        {confirmed
          ? t('appointments.public_confirmed', { defaultValue: 'Your appointment is booked' })
          : t('appointments.public_requested', { defaultValue: 'Your request has been sent' })}
      </h1>
      {!confirmed && <p className="mt-1 text-sm text-content-secondary">{t('appointments.public_requested_hint', { defaultValue: 'The business will confirm your request.' })}</p>}
      <div className="mx-auto mt-5 max-w-sm rounded-xl border border-border-light bg-surface-secondary p-4 text-left text-sm">
        <p className="font-medium">{result.service_name}</p>
        <p className="text-content-secondary">{parseLocal(result.start_at).toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <p className="tabular-nums text-content-secondary">{result.start_at.slice(11, 16)}–{result.end_at.slice(11, 16)}</p>
        {title && <p className="mt-1 text-xs text-content-tertiary">{title}</p>}
      </div>
      <button type="button" onClick={ics} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-secondary">
        <CalendarPlus size={16} />
        {t('appointments.add_to_my_calendar', { defaultValue: 'Add to my calendar' })}
      </button>
      <p className="mt-6 text-xs text-content-secondary">{t('appointments.public_keep_link', { defaultValue: 'Keep this link to view or cancel your booking:' })}</p>
      <Link to={`/booking/${result.cancel_token}`} className="break-all text-xs text-oe-blue underline">{manage}</Link>
    </div>
  );
}
