import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Repeat, Globe } from 'lucide-react';
import {
  STATUS_LABEL,
  addDays,
  dayKey,
  minToHHMM,
  parseLocal,
  placement,
  snap,
  type Booking,
  type Resource,
  type Service,
} from '../api';
import { layoutLanes } from '../scheduling';

const PX_PER_MIN = 1;
const STEP = 15;
const LOCKED: Booking['status'][] = ['completed', 'cancelled', 'no_show'];

interface Column {
  key: string;
  day: Date;
  resource: Resource;
  /** Day header shown above a group of resource columns (week, all resources). */
  group?: string;
  label: string;
}

export interface CalendarViewProps {
  view: 'day' | 'week';
  date: Date;
  weekStart: Date;
  resources: Resource[];
  /** Week view: one resource id, or '' to show every resource side by side per day. */
  resourceId: string;
  services: Service[];
  bookings: Booking[];
  onCreate: (resourceId: string, start: Date) => void;
  onOpen: (b: Booking) => void;
  onMove: (b: Booking, resourceId: string, start: Date) => void;
}

export const STATUS_STYLE: Record<Booking['status'], string> = {
  requested: 'border-amber-400 bg-amber-50 dark:bg-amber-950/40',
  confirmed: 'border-blue-400 bg-blue-50 dark:bg-blue-950/40',
  checked_in: 'border-purple-400 bg-purple-50 dark:bg-purple-950/40',
  completed: 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40',
  no_show: 'border-red-400 bg-red-50 dark:bg-red-950/40',
  cancelled: 'border-border bg-surface-secondary opacity-60 line-through',
};

/** Visible hour range: 07-21 by default, widened to fit any booking outside it. */
export function visibleRange(bookings: Pick<Booking, 'start_at' | 'end_at'>[]): [number, number] {
  let lo = 7 * 60;
  let hi = 21 * 60;
  for (const b of bookings) {
    const s = parseLocal(b.start_at);
    const e = parseLocal(b.end_at);
    lo = Math.min(lo, Math.floor((s.getHours() * 60 + s.getMinutes()) / 60) * 60);
    const em = e.getDate() !== s.getDate() ? 1440 : e.getHours() * 60 + e.getMinutes();
    hi = Math.max(hi, Math.ceil(em / 60) * 60);
  }
  return [lo, Math.min(hi, 1440)];
}

function useNowMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function CalendarView(p: CalendarViewProps) {
  const { t, i18n } = useTranslation();
  const now = useNowMinute();
  const [dropKey, setDropKey] = useState('');
  const [dayStart, dayEnd] = useMemo(() => visibleRange(p.bookings), [p.bookings]);

  const columns: Column[] = useMemo(() => {
    const fmt = (d: Date) => d.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' });
    if (p.view === 'day') return p.resources.map((r) => ({ key: r.id, day: p.date, resource: r, label: r.name }));
    const days = Array.from({ length: 7 }, (_, i) => addDays(p.weekStart, i));
    if (!p.resourceId) {
      return days.flatMap((d) =>
        p.resources.map((r) => ({ key: `${dayKey(d)}-${r.id}`, day: d, resource: r, group: fmt(d), label: r.name })),
      );
    }
    const r = p.resources.find((x) => x.id === p.resourceId);
    return r ? days.map((d) => ({ key: dayKey(d), day: d, resource: r, label: fmt(d) })) : [];
  }, [p.view, p.date, p.weekStart, p.resources, p.resourceId, i18n.language]);

  const service = useMemo(() => new Map(p.services.map((s) => [s.id, s])), [p.services]);
  const hours = Array.from({ length: (dayEnd - dayStart) / 60 }, (_, i) => dayStart + i * 60);
  const height = (dayEnd - dayStart) * PX_PER_MIN;
  const narrow = p.view === 'week' && !p.resourceId;
  const today = dayKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const minuteAt = (e: MouseEvent<HTMLDivElement> | DragEvent<HTMLDivElement>, grabOffset = 0) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = (e.clientY - rect.top) / PX_PER_MIN - grabOffset;
    return Math.min(Math.max(dayStart + snap(raw, STEP), dayStart), dayEnd - STEP);
  };
  const at = (day: Date, min: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, min);

  if (columns.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-content-secondary">
        {t('appointments.no_resources', { defaultValue: 'Add a staff member, room or chair under Resources to start booking.' })}
      </p>
    );
  }

  const groups: { label: string; span: number; today: boolean }[] = [];
  if (narrow) {
    for (const c of columns) {
      const last = groups[groups.length - 1];
      if (last && last.label === c.group) last.span += 1;
      else groups.push({ label: c.group ?? '', span: 1, today: dayKey(c.day) === today });
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface-primary" data-testid="appointments-calendar">
      <div className="flex min-w-max">
        <div className="sticky left-0 z-10 w-14 shrink-0 border-r border-border bg-surface-primary">
          {narrow && <div className="h-7 border-b border-border" />}
          <div className="h-9 border-b border-border" />
          <div className="relative" style={{ height }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-1 text-2xs tabular-nums text-content-tertiary" style={{ top: (h - dayStart) * PX_PER_MIN - 6 }}>
                {minToHHMM(h)}
              </div>
            ))}
          </div>
        </div>
        <div>
          {narrow && (
            <div className="flex h-7 border-b border-border">
              {groups.map((g, i) => (
                <div
                  key={`${g.label}-${i}`}
                  className={clsx('truncate border-r-2 border-border px-2 text-center text-xs font-semibold leading-7 last:border-r-0', g.today && 'text-oe-blue')}
                  style={{ width: g.span * 112 }}
                >
                  {g.label}
                </div>
              ))}
            </div>
          )}
          <div className="flex">
            {columns.map((col, idx) => {
              const key = dayKey(col.day);
              const isToday = key === today;
              const items = p.bookings.filter((b) => b.resource_id === col.resource.id && b.start_at.slice(0, 10) === key);
              const lanes = layoutLanes(items);
              const dayEdge = narrow && columns[idx + 1] && dayKey(columns[idx + 1]!.day) !== key;
              return (
                <div key={col.key} className={clsx('shrink-0 border-r border-border last:border-r-0', narrow ? 'w-28' : 'w-48', dayEdge && 'border-r-2')}>
                  <div className={clsx('flex h-9 items-center justify-center gap-1.5 truncate border-b border-border px-2 text-xs font-medium', isToday && !narrow && 'text-oe-blue')}>
                    {col.resource.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: col.resource.color }} />}
                    <span className="truncate">{col.label}</span>
                  </div>
                  <div
                    className={clsx('relative cursor-copy', isToday && 'bg-oe-blue/[0.03]', dropKey === col.key && 'bg-oe-blue/10')}
                    style={{ height }}
                    role="grid"
                    aria-label={`${col.group ? `${col.group} · ` : ''}${col.label}`}
                    onClick={(e) => {
                      if (e.target === e.currentTarget) p.onCreate(col.resource.id, at(col.day, minuteAt(e)));
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dropKey !== col.key) setDropKey(col.key);
                    }}
                    onDragLeave={() => setDropKey('')}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropKey('');
                      const id = e.dataTransfer.getData('text/booking-id');
                      const grab = Number(e.dataTransfer.getData('text/grab-offset') || 0);
                      const b = p.bookings.find((x) => x.id === id);
                      if (b) p.onMove(b, col.resource.id, at(col.day, minuteAt(e, grab)));
                    }}
                  >
                    {hours.map((h) => (
                      <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top: (h - dayStart) * PX_PER_MIN }} />
                    ))}
                    {isToday && nowMin >= dayStart && nowMin <= dayEnd && (
                      <div className="pointer-events-none absolute inset-x-0 z-[5] border-t-2 border-red-500" style={{ top: (nowMin - dayStart) * PX_PER_MIN }} aria-hidden="true">
                        <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-red-500" />
                      </div>
                    )}
                    {items.map((b) => {
                      const pos = placement(b, dayStart, dayEnd);
                      const lane = lanes.get(b.id) ?? { lane: 0, lanes: 1 };
                      const svc = service.get(b.service_id);
                      const movable = !LOCKED.includes(b.status);
                      const width = 100 / lane.lanes;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          draggable={movable}
                          onDragStart={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/booking-id', b.id);
                            e.dataTransfer.setData('text/grab-offset', String((e.clientY - rect.top) / PX_PER_MIN));
                          }}
                          onClick={() => p.onOpen(b)}
                          className={clsx(
                            'absolute overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-2xs shadow-xs transition-shadow hover:z-10 hover:shadow-md focus:z-10 focus:outline-none focus:ring-2 focus:ring-oe-blue/40',
                            STATUS_STYLE[b.status],
                            movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                          )}
                          style={{
                            top: pos.top * PX_PER_MIN,
                            height: pos.height * PX_PER_MIN,
                            left: `calc(${lane.lane * width}% + 2px)`,
                            width: `calc(${width}% - 4px)`,
                            ...(svc?.color ? { borderLeftColor: svc.color } : {}),
                          }}
                          title={`${b.client_name} · ${svc?.name ?? ''} · ${t(`appointments.status_${b.status}`, { defaultValue: STATUS_LABEL[b.status] })}`}
                        >
                          <span className="flex items-center gap-1 font-medium">
                            <span className="tabular-nums">{b.start_at.slice(11, 16)}</span>
                            <span className="truncate">{b.client_name}</span>
                            {b.series_id && <Repeat size={10} className="shrink-0" aria-hidden="true" />}
                            {b.source === 'online' && <Globe size={10} className="shrink-0" aria-hidden="true" />}
                          </span>
                          {pos.height >= 30 && <span className="block truncate text-content-secondary">{svc?.name ?? ''}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
