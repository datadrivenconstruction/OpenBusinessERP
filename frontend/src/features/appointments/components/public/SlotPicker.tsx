import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, dayKey, parseLocal } from '../../api';
import { groupByDay, partOfDay } from '../../scheduling';

interface Props {
  from: Date;
  slots: string[] | undefined;
  loading: boolean;
  maxDaysAhead: number;
  selected: string;
  onFrom: (d: Date) => void;
  onSelect: (iso: string) => void;
}

const PARTS = ['morning', 'afternoon', 'evening'] as const;
const PART_LABEL = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

/** Week strip of days (with free-slot counts) and the times of the chosen day. */
export function SlotPicker({ from, slots, loading, maxDaysAhead, selected, onFrom, onSelect }: Props) {
  const { t, i18n } = useTranslation();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(from, i)), [from]);
  const byDay = useMemo(() => new Map(groupByDay(slots ?? [])), [slots]);
  const firstFree = days.find((d) => byDay.has(dayKey(d)));
  const [day, setDay] = useState('');
  useEffect(() => {
    if (!day || !days.some((d) => dayKey(d) === day)) setDay(firstFree ? dayKey(firstFree) : '');
  }, [days, firstFree, day]);
  const today = dayKey(new Date());
  const last = dayKey(addDays(new Date(), maxDaysAhead));
  const times = byDay.get(day) ?? [];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" disabled={dayKey(from) <= today} onClick={() => onFrom(addDays(from, -7))} className="rounded-lg p-2 hover:bg-surface-secondary disabled:opacity-30" aria-label={t('appointments.previous', { defaultValue: 'Previous' })}>
          <ChevronLeft size={18} />
        </button>
        <p className="text-sm font-medium">
          {from.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })}
        </p>
        <button type="button" disabled={dayKey(addDays(from, 7)) > last} onClick={() => onFrom(addDays(from, 7))} className="rounded-lg p-2 hover:bg-surface-secondary disabled:opacity-30" aria-label={t('appointments.next', { defaultValue: 'Next' })}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1" role="tablist" aria-label={t('appointments.public_pick_day', { defaultValue: 'Pick a day' })}>
        {days.map((d) => {
          const k = dayKey(d);
          const count = byDay.get(k)?.length ?? 0;
          const on = k === day;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={on}
              disabled={count === 0}
              onClick={() => setDay(k)}
              className={clsx(
                'flex flex-col items-center rounded-lg border py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                on ? 'border-oe-blue bg-oe-blue text-content-inverse' : 'border-border hover:border-oe-blue/50',
              )}
            >
              <span className="uppercase">{d.toLocaleDateString(i18n.language, { weekday: 'short' })}</span>
              <span className="text-base font-semibold tabular-nums">{d.getDate()}</span>
              <span className={clsx('h-1 w-1 rounded-full', count ? (on ? 'bg-white' : 'bg-emerald-500') : 'bg-transparent')} />
            </button>
          );
        })}
      </div>

      <div className="mt-4 min-h-[120px]" role="tabpanel">
        {loading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-surface-tertiary" />)}
          </div>
        ) : !firstFree ? (
          <p className="rounded-lg bg-surface-secondary p-4 text-center text-sm text-content-secondary">
            {t('appointments.public_no_slots', { defaultValue: 'No free times this week. Try the next week.' })}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium">{parseLocal(day).toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            {PARTS.map((part) => {
              const list = times.filter((s) => partOfDay(s) === part);
              if (list.length === 0) return null;
              return (
                <div key={part}>
                  <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-content-tertiary">{t(`appointments.part_${part}`, { defaultValue: PART_LABEL[part] })}</p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {list.map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={selected === s}
                        onClick={() => onSelect(s)}
                        className={clsx('h-10 rounded-lg border text-sm font-medium tabular-nums transition-colors', selected === s ? 'border-oe-blue bg-oe-blue text-content-inverse' : 'border-border hover:border-oe-blue')}
                      >
                        {s.slice(11, 16)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
