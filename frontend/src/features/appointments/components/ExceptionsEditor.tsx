import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { CalendarOff, CalendarPlus, Trash2 } from 'lucide-react';
import { Button } from '@/shared/ui';
import { DateDisplay } from '@/shared/ui/DateDisplay';
import { useToastStore } from '@/stores/useToastStore';
import { getErrorMessage } from '@/shared/lib/api';
import { appointmentsApi, dayKey, hhmmToMin, minToHHMM } from '../api';
import { dateRange } from '../scheduling';

const input = 'h-8 rounded-lg border border-border bg-surface-primary px-2 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';

/** Dated exceptions: days off / holidays (whole day or part) and extra opening hours. */
export function ExceptionsEditor({ resourceId }: { resourceId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const key = ['appointments', 'exceptions', resourceId];
  const exceptions = useQuery({ queryKey: key, queryFn: () => appointmentsApi.exceptions(resourceId) });
  const [kind, setKind] = useState<'closed' | 'open'>('closed');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [partial, setPartial] = useState(false);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  const [label, setLabel] = useState('');
  const days = dateRange(from, to);
  const timed = kind === 'open' || partial;

  const add = useMutation({
    mutationFn: async () => {
      for (const day of days) {
        await appointmentsApi.addException(resourceId, {
          day,
          kind,
          start_min: timed ? hhmmToMin(start) : null,
          end_min: timed ? hhmmToMin(end) : null,
          label,
        });
      }
    },
    onSuccess: () => {
      setFrom('');
      setTo('');
      setLabel('');
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: key });
      addToast({ type: 'error', title: getErrorMessage(e) });
    },
  });
  const remove = useMutation({
    mutationFn: appointmentsApi.removeException,
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => addToast({ type: 'error', title: getErrorMessage(e) }),
  });
  const today = dayKey(new Date());
  const list = [...(exceptions.data ?? [])].sort((a, b) => a.day.localeCompare(b.day));
  const upcoming = list.filter((e) => e.day >= today);
  const past = list.length - upcoming.length;

  return (
    <div className="space-y-2 border-t border-border-light pt-3">
      <p className="text-xs font-semibold">{t('appointments.exceptions', { defaultValue: 'Days off, holidays and extra hours' })}</p>
      {upcoming.length === 0 ? (
        <p className="text-xs text-content-tertiary">{t('appointments.no_exceptions', { defaultValue: 'No upcoming exceptions.' })}</p>
      ) : (
        <ul className="divide-y divide-border-light rounded-md border border-border-light bg-surface-primary text-xs">
          {upcoming.map((ex) => (
            <li key={ex.id} className="flex items-center gap-2 px-2 py-1.5">
              {ex.kind === 'closed' ? <CalendarOff size={13} className="text-semantic-error" /> : <CalendarPlus size={13} className="text-emerald-600" />}
              <DateDisplay value={ex.day} className="w-24 tabular-nums" />
              <span className={clsx('font-medium', ex.kind === 'closed' ? 'text-semantic-error' : 'text-emerald-700 dark:text-emerald-400')}>
                {ex.kind === 'closed' ? t('appointments.closed', { defaultValue: 'Closed' }) : t('appointments.extra_open', { defaultValue: 'Extra opening' })}
              </span>
              <span className="tabular-nums">{ex.start_min !== null && ex.end_min !== null ? `${minToHHMM(ex.start_min)}–${minToHHMM(ex.end_min)}` : t('appointments.whole_day', { defaultValue: 'whole day' })}</span>
              <span className="truncate text-content-secondary">{ex.label}</span>
              <button type="button" className="ml-auto rounded p-1 text-content-tertiary hover:text-semantic-error" aria-label={t('common.delete', { defaultValue: 'Delete' })} onClick={() => remove.mutate(ex.id)}>
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {past > 0 && <p className="text-2xs text-content-tertiary">{t('appointments.past_exceptions', { defaultValue: '{{count}} past entries hidden', count: past })}</p>}

      <div className="flex flex-wrap items-end gap-2 rounded-md bg-surface-primary p-2">
        <select className={input} value={kind} onChange={(e) => setKind(e.target.value as 'closed' | 'open')} aria-label={t('appointments.exception_kind', { defaultValue: 'Type' })}>
          <option value="closed">{t('appointments.closed', { defaultValue: 'Closed' })}</option>
          <option value="open">{t('appointments.extra_open', { defaultValue: 'Extra opening' })}</option>
        </select>
        <label className="text-2xs text-content-secondary">
          {t('appointments.from', { defaultValue: 'From' })}
          <input type="date" className={clsx(input, 'block')} value={from} min={today} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-2xs text-content-secondary">
          {t('appointments.until_optional', { defaultValue: 'Until (optional)' })}
          <input type="date" className={clsx(input, 'block')} value={to} min={from || today} onChange={(e) => setTo(e.target.value)} />
        </label>
        {kind === 'closed' && (
          <label className="flex items-center gap-1 pb-1.5 text-xs">
            <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />
            {t('appointments.part_of_day', { defaultValue: 'Part of the day' })}
          </label>
        )}
        {timed && (
          <>
            <input type="time" step={300} className={input} value={start} onChange={(e) => setStart(e.target.value)} aria-label={t('appointments.from', { defaultValue: 'From' })} />
            <input type="time" step={300} className={input} value={end} onChange={(e) => setEnd(e.target.value)} aria-label={t('appointments.to', { defaultValue: 'To' })} />
          </>
        )}
        <input className={clsx(input, 'min-w-[140px] flex-1')} placeholder={t('appointments.exception_label', { defaultValue: 'Reason (e.g. holiday)' })} value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button size="sm" variant="secondary" onClick={() => add.mutate()} disabled={days.length === 0 || add.isPending || (timed && hhmmToMin(end) <= hhmmToMin(start))}>
          {days.length > 1 ? t('appointments.add_days', { defaultValue: 'Add {{count}} days', count: days.length }) : t('appointments.add_exception', { defaultValue: 'Add' })}
        </Button>
      </div>
    </div>
  );
}
