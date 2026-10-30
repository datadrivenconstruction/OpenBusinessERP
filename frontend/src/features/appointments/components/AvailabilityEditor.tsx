import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/shared/ui';
import { useToastStore } from '@/stores/useToastStore';
import { getErrorMessage } from '@/shared/lib/api';
import { appointmentsApi, hhmmToMin, minToHHMM, type Hours, type Resource } from '../api';
import { copyDay, invalidDays, weeklyMinutes } from '../scheduling';
import { ExceptionsEditor } from './ExceptionsEditor';

const input = 'h-8 rounded-lg border border-border bg-surface-primary px-2 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DEFAULT_HOURS: Hours[] = [0, 1, 2, 3, 4].map((weekday) => ({ weekday, start_min: 540, end_min: 1020, kind: 'work' }));
const PRESETS: { key: string; label: string; rows: () => Hours[] }[] = [
  { key: 'office', label: 'Mon–Fri 9–17', rows: () => DEFAULT_HOURS.map((r) => ({ ...r })) },
  {
    key: 'lunch',
    label: 'Mon–Fri 9–18, lunch 13–14',
    rows: () => [0, 1, 2, 3, 4].flatMap((weekday) => [
      { weekday, start_min: 540, end_min: 1080, kind: 'work' as const },
      { weekday, start_min: 780, end_min: 840, kind: 'break' as const },
    ]),
  },
  { key: 'six', label: 'Mon–Sat 10–19', rows: () => [0, 1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_min: 600, end_min: 1140, kind: 'work' as const })) },
];

/** Strip ids so rows compare by value (dirty check). */
const clean = (rows: Hours[]) => rows.map(({ weekday, start_min, end_min, kind }) => ({ weekday, start_min, end_min, kind }));

/** Weekly working hours and breaks per resource, plus dated exceptions. */
export function AvailabilityEditor({ resource }: { resource: Resource }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const hours = useQuery({ queryKey: ['appointments', 'hours', resource.id], queryFn: () => appointmentsApi.hours(resource.id) });
  const [rows, setRows] = useState<Hours[]>([]);
  useEffect(() => {
    if (hours.data) setRows(clean(hours.data));
  }, [hours.data]);
  const dirty = useMemo(() => JSON.stringify(clean(hours.data ?? [])) !== JSON.stringify(rows), [hours.data, rows]);
  const bad = invalidDays(rows);
  const save = useMutation({
    mutationFn: () => appointmentsApi.setHours(resource.id, rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments', 'hours', resource.id] });
      addToast({ type: 'success', title: t('appointments.hours_saved', { defaultValue: 'Working hours saved' }) });
    },
    onError: (e) => addToast({ type: 'error', title: getErrorMessage(e) }),
  });

  const update = (idx: number, patch: Partial<Hours>) => setRows(rows.map((r, j) => (j === idx ? { ...r, ...patch } : r)));
  const add = (weekday: number, kind: Hours['kind']) => {
    const day = rows.filter((r) => r.weekday === weekday && r.kind === 'work');
    const base = kind === 'break' ? { start_min: 780, end_min: 840 } : day.length ? { start_min: Math.min(day[day.length - 1]!.end_min + 60, 1380), end_min: Math.min(day[day.length - 1]!.end_min + 180, 1440) } : { start_min: 540, end_min: 1020 };
    setRows([...rows, { weekday, kind, ...base }]);
  };
  const total = weeklyMinutes(rows);

  return (
    <div className="space-y-4 rounded-lg bg-surface-secondary/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold">{t('appointments.weekly_hours', { defaultValue: 'Weekly working hours and breaks' })}</p>
        <span className="text-2xs text-content-tertiary">{t('appointments.hours_total', { defaultValue: '{{h}} h bookable per week', h: Math.round((total / 60) * 10) / 10 })}</span>
        <div className="ml-auto flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => setRows(p.rows())} className="rounded-md border border-border px-2 py-0.5 text-2xs hover:bg-surface-primary">
              {t(`appointments.preset_${p.key}`, { defaultValue: p.label })}
            </button>
          ))}
        </div>
      </div>

      <ul className="space-y-1.5">
        {WEEKDAYS.map((wd, d) => {
          const dayRows = rows.map((r, idx) => ({ r, idx })).filter((x) => x.r.weekday === d).sort((a, b) => a.r.start_min - b.r.start_min);
          const open = dayRows.some((x) => x.r.kind === 'work');
          return (
            <li key={wd} className={clsx('rounded-md border bg-surface-primary p-2', bad.includes(d) ? 'border-semantic-error' : 'border-border-light')}>
              <div className="flex flex-wrap items-start gap-2">
                <label className="flex w-24 shrink-0 items-center gap-2 pt-1 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={open}
                    onChange={(e) => (e.target.checked ? add(d, 'work') : setRows(rows.filter((r) => r.weekday !== d)))}
                  />
                  {t(`appointments.wd_${d}`, { defaultValue: wd })}
                </label>
                <div className="min-w-0 flex-1 space-y-1">
                  {!open && <p className="pt-1 text-xs text-content-tertiary">{t('appointments.closed', { defaultValue: 'Closed' })}</p>}
                  {dayRows.map(({ r, idx }) => (
                    <div key={idx} className="flex flex-wrap items-center gap-1.5">
                      <span className={clsx('w-16 text-2xs font-medium uppercase', r.kind === 'break' ? 'text-amber-600' : 'text-emerald-600')}>
                        {r.kind === 'break' ? t('appointments.hours_break', { defaultValue: 'Break' }) : t('appointments.hours_work', { defaultValue: 'Working' })}
                      </span>
                      <input type="time" step={300} className={input} value={minToHHMM(r.start_min)} onChange={(e) => update(idx, { start_min: hhmmToMin(e.target.value) })} aria-label={t('appointments.from', { defaultValue: 'From' })} />
                      <span className="text-content-tertiary">–</span>
                      <input type="time" step={300} className={input} value={minToHHMM(Math.min(r.end_min, 1439))} onChange={(e) => update(idx, { end_min: hhmmToMin(e.target.value) })} aria-label={t('appointments.to', { defaultValue: 'To' })} />
                      <button type="button" className="rounded p-1 text-content-tertiary hover:text-semantic-error" aria-label={t('common.delete', { defaultValue: 'Delete' })} onClick={() => setRows(rows.filter((_, j) => j !== idx))}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {open && <DayBar rows={dayRows.map((x) => x.r)} />}
                </div>
                {open && (
                  <div className="flex shrink-0 gap-1">
                    <button type="button" title={t('appointments.add_hours', { defaultValue: 'Add time range' })} aria-label={t('appointments.add_hours', { defaultValue: 'Add time range' })} onClick={() => add(d, 'work')} className="rounded p-1 text-content-tertiary hover:bg-surface-secondary"><Plus size={14} /></button>
                    <button type="button" onClick={() => add(d, 'break')} className="rounded px-1.5 py-0.5 text-2xs text-content-tertiary hover:bg-surface-secondary">{t('appointments.add_break', { defaultValue: '+ break' })}</button>
                    <button
                      type="button"
                      title={t('appointments.copy_to_all', { defaultValue: 'Copy to all weekdays' })}
                      aria-label={t('appointments.copy_to_all', { defaultValue: 'Copy to all weekdays' })}
                      onClick={() => setRows(copyDay(rows, d, [0, 1, 2, 3, 4]))}
                      className="rounded p-1 text-content-tertiary hover:bg-surface-secondary"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {bad.length > 0 && (
        <p className="text-xs text-semantic-error" role="alert">{t('appointments.hours_invalid', { defaultValue: 'Check the highlighted days: a range ends before it starts or working ranges overlap.' })}</p>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => save.mutate()} disabled={save.isPending || !dirty || bad.length > 0}>
          {t('appointments.save_hours', { defaultValue: 'Save hours' })}
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setRows(clean(hours.data ?? []))}>{t('appointments.discard', { defaultValue: 'Discard changes' })}</Button>
        )}
      </div>

      <ExceptionsEditor resourceId={resource.id} />
    </div>
  );
}

/** 06:00–22:00 strip showing working time (green) and breaks (amber) of one day. */
function DayBar({ rows }: { rows: Hours[] }) {
  const lo = 360;
  const span = 960;
  const pos = (m: number) => `${(Math.min(Math.max(m - lo, 0), span) / span) * 100}%`;
  return (
    <div className="relative mt-1 h-1.5 rounded-full bg-surface-tertiary" aria-hidden="true">
      {rows.map((r, i) => (
        <div
          key={i}
          className={clsx('absolute inset-y-0 rounded-full', r.kind === 'break' ? 'z-[1] bg-amber-400' : 'bg-emerald-500')}
          style={{ left: pos(r.start_min), width: `calc(${pos(r.end_min)} - ${pos(r.start_min)})` }}
        />
      ))}
    </div>
  );
}
