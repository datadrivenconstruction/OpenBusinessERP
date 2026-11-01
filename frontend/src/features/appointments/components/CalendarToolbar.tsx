import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/shared/ui';
import { STATUSES, STATUS_LABEL, addDays, type Resource } from '../api';
import { DateField } from '@/shared/ui/DateField';

export const inputCls =
  'h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';

interface Props {
  view: 'day' | 'week';
  date: Date;
  weekStart: Date;
  resources: Resource[];
  resourceId: string;
  showCancelled: boolean;
  onView: (v: 'day' | 'week') => void;
  onDate: (d: Date) => void;
  onResource: (id: string) => void;
  onShowCancelled: (v: boolean) => void;
}

export function CalendarToolbar(p: Props) {
  const { t, i18n } = useTranslation();
  const shift = (n: number) => p.onDate(addDays(p.date, p.view === 'day' ? n : n * 7));
  const title =
    p.view === 'day'
      ? p.date.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : `${p.weekStart.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })} – ${addDays(p.weekStart, 6).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => p.onDate(new Date())}>{t('appointments.today', { defaultValue: 'Today' })}</Button>
      <Button size="sm" variant="secondary" aria-label={t('appointments.previous', { defaultValue: 'Previous' })} onClick={() => shift(-1)} icon={<ChevronLeft size={14} />} />
      <Button size="sm" variant="secondary" aria-label={t('appointments.next', { defaultValue: 'Next' })} onClick={() => shift(1)} icon={<ChevronRight size={14} />} />
      <DateField
       
        className={clsx(inputCls, 'w-auto')}
        value={`${p.date.getFullYear()}-${String(p.date.getMonth() + 1).padStart(2, '0')}-${String(p.date.getDate()).padStart(2, '0')}`}
        onChange={(e) => {
          const [y, m, d] = e.target.value.split('-').map(Number);
          if (y && m && d) p.onDate(new Date(y, m - 1, d));
        }}
        aria-label={t('appointments.go_to_date', { defaultValue: 'Go to date' })}
      />
      <span className="text-sm font-medium" aria-live="polite">{title}</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-content-secondary">
          <input type="checkbox" checked={p.showCancelled} onChange={(e) => p.onShowCancelled(e.target.checked)} />
          {t('appointments.show_cancelled', { defaultValue: 'Show cancelled' })}
        </label>
        {p.view === 'week' && (
          <select className={clsx(inputCls, 'max-w-[200px]')} value={p.resourceId} onChange={(e) => p.onResource(e.target.value)} aria-label={t('appointments.resource', { defaultValue: 'Resource' })}>
            <option value="">{t('appointments.all_resources', { defaultValue: 'All resources' })}</option>
            {p.resources.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}
        <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label={t('appointments.view', { defaultValue: 'View' })}>
          {(['day', 'week'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={p.view === v}
              onClick={() => p.onView(v)}
              className={clsx('rounded-md px-3 py-1 text-xs font-medium', p.view === v ? 'bg-oe-blue text-content-inverse' : 'text-content-secondary hover:text-content-primary')}
            >
              {v === 'day' ? t('appointments.view_day', { defaultValue: 'Day' }) : t('appointments.view_week', { defaultValue: 'Week' })}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Colour legend for booking statuses under the calendar. */
export function StatusLegend() {
  const { t } = useTranslation();
  const dot: Record<string, string> = {
    requested: 'bg-amber-400', confirmed: 'bg-blue-400', checked_in: 'bg-purple-400',
    completed: 'bg-emerald-400', no_show: 'bg-red-400', cancelled: 'bg-border',
  };
  return (
    <ul className="flex flex-wrap gap-3 text-2xs text-content-tertiary">
      {STATUSES.map((s) => (
        <li key={s} className="flex items-center gap-1">
          <span className={clsx('h-2 w-2 rounded-full', dot[s])} />
          {t(`appointments.status_${s}`, { defaultValue: STATUS_LABEL[s] })}
        </li>
      ))}
    </ul>
  );
}
