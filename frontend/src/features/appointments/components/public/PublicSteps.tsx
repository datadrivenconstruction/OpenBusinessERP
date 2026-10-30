import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Check, Clock } from 'lucide-react';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import type { PublicService } from '../../api';

export function PublicShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-surface-secondary px-3 py-6 sm:px-4 sm:py-10">
      <main className={clsx('mx-auto rounded-2xl bg-surface-primary p-4 shadow-sm sm:p-6', wide ? 'max-w-2xl' : 'max-w-xl')}>{children}</main>
    </div>
  );
}

export type PublicStep = 0 | 1 | 2;

/** Numbered progress for service → time → details; finished steps are clickable to go back. */
export function Stepper({ step, onStep }: { step: PublicStep; onStep: (s: PublicStep) => void }) {
  const { t } = useTranslation();
  const labels = [
    t('appointments.service', { defaultValue: 'Service' }),
    t('appointments.public_time', { defaultValue: 'Time' }),
    t('appointments.public_details', { defaultValue: 'Your details' }),
  ];
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label={t('appointments.public_steps', { defaultValue: 'Booking steps' })}>
      {labels.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              disabled={!done}
              onClick={() => onStep(i as PublicStep)}
              aria-current={current ? 'step' : undefined}
              className="flex min-w-0 items-center gap-2 disabled:cursor-default"
            >
              <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold', done ? 'bg-emerald-500 text-white' : current ? 'bg-oe-blue text-content-inverse' : 'bg-surface-tertiary text-content-tertiary')}>
                {done ? <Check size={14} /> : i + 1}
              </span>
              <span className={clsx('hidden truncate text-xs font-medium sm:inline', current ? 'text-content-primary' : 'text-content-tertiary')}>{label}</span>
            </button>
            {i < labels.length - 1 && <span className={clsx('h-px flex-1', done ? 'bg-emerald-500' : 'bg-border')} />}
          </li>
        );
      })}
    </ol>
  );
}

export function ServiceStep({ services, selected, onSelect }: { services: PublicService[]; selected: string; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  if (services.length === 0) {
    return <p className="text-sm text-content-secondary">{t('appointments.public_no_services', { defaultValue: 'No services can be booked online right now.' })}</p>;
  }
  return (
    <div className="space-y-2" role="radiogroup" aria-label={t('appointments.service', { defaultValue: 'Service' })}>
      {services.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={selected === s.id}
          onClick={() => onSelect(s.id)}
          className={clsx(
            'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors',
            selected === s.id ? 'border-oe-blue bg-blue-50 ring-1 ring-oe-blue dark:bg-blue-950/30' : 'border-border hover:border-oe-blue/50',
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">{s.name}</p>
            {s.description && <p className="mt-0.5 text-xs text-content-secondary">{s.description}</p>}
            <p className="mt-1.5 flex items-center gap-1 text-xs text-content-tertiary">
              <Clock size={12} />
              {s.duration_min} {t('appointments.min', { defaultValue: 'min' })}
            </p>
          </div>
          {Number(s.price) > 0 && <span className="shrink-0 text-sm font-semibold"><MoneyDisplay amount={s.price} currency={s.currency} /></span>}
        </button>
      ))}
    </div>
  );
}
