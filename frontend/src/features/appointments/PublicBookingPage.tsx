import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, CalendarX2, Clock } from 'lucide-react';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { dayKey, parseLocal, publicApi, type PublicBookingResult } from './api';
import { PublicConfirmation } from './components/public/PublicConfirmation';
import { PublicShell, ServiceStep, Stepper, type PublicStep } from './components/public/PublicSteps';
import { SlotPicker } from './components/public/SlotPicker';

const input = 'w-full rounded-lg border border-border bg-surface-primary px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';
const primaryBtn = 'w-full rounded-lg bg-oe-blue px-4 py-3 text-sm font-semibold text-content-inverse disabled:opacity-50';

/** Public, login-free booking page at /book/:slug. Shows only services and free times. */
export function PublicBookingPage() {
  const { t, i18n } = useTranslation();
  const { slug = '' } = useParams();
  const profile = useQuery({ queryKey: ['public-booking', slug], queryFn: () => publicApi.profile(slug), retry: false });
  const [step, setStep] = useState<PublicStep>(0);
  const [serviceId, setServiceId] = useState('');
  const [from, setFrom] = useState(() => new Date());
  const [slot, setSlot] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', note: '', consent: false, website: '' });
  const [result, setResult] = useState<PublicBookingResult | null>(null);
  const slots = useQuery({
    queryKey: ['public-booking', slug, serviceId, dayKey(from)],
    queryFn: () => publicApi.slots(slug, serviceId, dayKey(from), 7),
    enabled: !!serviceId,
    retry: false,
  });
  const book = useMutation({
    mutationFn: () => publicApi.book(slug, { service_id: serviceId, start_at: slot, ...form }),
    onSuccess: setResult,
    onError: () => void slots.refetch(),
  });

  if (profile.isError) {
    return (
      <PublicShell>
        <div className="py-8 text-center">
          <CalendarX2 size={40} className="mx-auto text-content-tertiary" />
          <p className="mt-3 text-sm">{t('appointments.public_unavailable', { defaultValue: 'This booking page is not available.' })}</p>
        </div>
      </PublicShell>
    );
  }
  if (!profile.data) {
    return (
      <PublicShell>
        <div className="space-y-3" aria-busy="true">
          <div className="h-6 w-1/2 animate-pulse rounded bg-surface-tertiary" />
          <div className="h-16 animate-pulse rounded-xl bg-surface-tertiary" />
          <div className="h-16 animate-pulse rounded-xl bg-surface-tertiary" />
        </div>
      </PublicShell>
    );
  }
  const p = profile.data;
  if (result) return <PublicShell><PublicConfirmation result={result} title={p.title} /></PublicShell>;

  const service = p.services.find((s) => s.id === serviceId);
  const when = slot ? parseLocal(slot).toLocaleString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <PublicShell>
      <h1 className="text-xl font-semibold sm:text-2xl">{p.title || t('appointments.public_heading', { defaultValue: 'Book an appointment' })}</h1>
      <p className="mb-5 mt-1 text-sm text-content-secondary">{t('appointments.public_intro', { defaultValue: 'Choose a service and a time that suits you.' })}</p>
      <Stepper step={step} onStep={setStep} />

      {step > 0 && service && (
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-surface-secondary p-3 text-sm">
          <button type="button" onClick={() => setStep((step - 1) as PublicStep)} className="rounded-lg p-1.5 hover:bg-surface-primary" aria-label={t('appointments.back', { defaultValue: 'Back' })}>
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{service.name}</p>
            <p className="flex items-center gap-1 text-xs text-content-secondary">
              <Clock size={12} />
              {step === 2 && when ? when : `${service.duration_min} ${t('appointments.min', { defaultValue: 'min' })}`}
            </p>
          </div>
          {Number(service.price) > 0 && <span className="font-semibold"><MoneyDisplay amount={service.price} currency={service.currency} /></span>}
        </div>
      )}

      {step === 0 && (
        <ServiceStep
          services={p.services}
          selected={serviceId}
          onSelect={(id) => {
            setServiceId(id);
            setSlot('');
            setStep(1);
          }}
        />
      )}

      {step === 1 && (
        <SlotPicker
          from={from}
          slots={slots.data?.map((s) => s.start_at)}
          loading={slots.isLoading}
          maxDaysAhead={p.max_days_ahead}
          selected={slot}
          onFrom={setFrom}
          onSelect={(s) => {
            setSlot(s);
            setStep(2);
          }}
        />
      )}

      {step === 2 && slot && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            book.mutate();
          }}
        >
          <Field label={t('appointments.name', { defaultValue: 'Name' })} id="pb-name">
            <input id="pb-name" required className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
          </Field>
          <Field label={t('appointments.email', { defaultValue: 'Email' })} id="pb-email">
            <input id="pb-email" required type="email" inputMode="email" className={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
          </Field>
          <Field label={t('appointments.phone_optional', { defaultValue: 'Phone (optional)' })} id="pb-phone">
            <input id="pb-phone" type="tel" inputMode="tel" className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" />
          </Field>
          <Field label={t('appointments.public_note', { defaultValue: 'Message (optional)' })} id="pb-note">
            <textarea id="pb-note" rows={2} maxLength={1000} className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <p className="mt-1 text-2xs text-content-tertiary">{t('appointments.public_note_hint', { defaultValue: 'Please do not include health or other sensitive details.' })}</p>
          </Field>
          <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          <label className="flex items-start gap-2.5 rounded-lg bg-surface-secondary p-3 text-xs">
            <input type="checkbox" required checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-0.5 h-4 w-4" />
            <span>
              {t('appointments.public_consent', { defaultValue: 'I agree that my details are stored to manage this appointment.' })}{' '}
              {p.privacy_url && (
                <a href={p.privacy_url} target="_blank" rel="noopener noreferrer" className="text-oe-blue underline">
                  {t('appointments.public_privacy', { defaultValue: 'Privacy policy' })}
                </a>
              )}
            </span>
          </label>
          {book.isError && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">
              {(book.error as Error).message}{' '}
              <button type="button" className="underline" onClick={() => setStep(1)}>{t('appointments.public_pick_other', { defaultValue: 'Pick another time' })}</button>
            </p>
          )}
          <div className="sticky bottom-0 -mx-4 border-t border-border-light bg-surface-primary px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:p-0">
            <button type="submit" disabled={book.isPending || !form.consent} className={clsx(primaryBtn)}>
              {book.isPending ? '…' : t('appointments.public_book', { defaultValue: 'Book {{time}}', time: when })}
            </button>
          </div>
        </form>
      )}
    </PublicShell>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-content-secondary">{label}</label>
      {children}
    </div>
  );
}

/** Public view of one booking by its secret token, with online cancellation. */
export function PublicBookingManagePage() {
  const { t, i18n } = useTranslation();
  const { token = '' } = useParams();
  const view = useQuery({ queryKey: ['public-booking-view', token], queryFn: () => publicApi.view(token), retry: false });
  const [confirming, setConfirming] = useState(false);
  const cancel = useMutation({ mutationFn: () => publicApi.cancel(token), onSuccess: () => view.refetch() });
  if (view.isError) {
    return <PublicShell><p className="py-8 text-center text-sm">{t('appointments.public_not_found', { defaultValue: 'Booking not found.' })}</p></PublicShell>;
  }
  if (!view.data) return <PublicShell><div className="h-24 animate-pulse rounded-xl bg-surface-tertiary" /></PublicShell>;
  const b = view.data;
  return (
    <PublicShell>
      {b.title && <p className="text-sm text-content-secondary">{b.title}</p>}
      <h1 className="mb-2 text-xl font-semibold">{b.service_name}</h1>
      <p className="text-sm">{parseLocal(b.start_at).toLocaleString(i18n.language, { dateStyle: 'full', timeStyle: 'short' })}</p>
      <p className={clsx('mt-3 inline-block rounded-full px-3 py-1 text-xs font-medium', b.status === 'cancelled' ? 'bg-surface-tertiary' : b.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300')}>
        {t(`appointments.status_${b.status}`, { defaultValue: b.status })}
      </p>
      {b.can_cancel && !confirming && (
        <button type="button" onClick={() => setConfirming(true)} className="mt-5 block w-full rounded-lg border border-red-500 px-4 py-2.5 text-sm font-medium text-red-600 sm:w-auto">
          {t('appointments.public_cancel', { defaultValue: 'Cancel appointment' })}
        </button>
      )}
      {b.can_cancel && confirming && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
          <p>{t('appointments.public_cancel_confirm', { defaultValue: 'Cancel this appointment?' })}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">{t('appointments.public_cancel_yes', { defaultValue: 'Yes, cancel' })}</button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-xs">{t('appointments.public_keep', { defaultValue: 'Keep it' })}</button>
          </div>
        </div>
      )}
      {cancel.isError && <p className="mt-2 text-sm text-red-600">{(cancel.error as Error).message}</p>}
    </PublicShell>
  );
}
