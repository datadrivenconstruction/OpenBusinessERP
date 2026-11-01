// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useIntlLocale } from '@/shared/lib/intlLocale';
import { usePreferencesStore, type DateFormat } from '@/stores/usePreferencesStore';

type Field = 'day' | 'month' | 'year';
export interface DatePattern {
  order: Field[];
  sep: string;
}

/** Field order and separator for a locale, honouring an explicit user preference. */
export function datePatternFor(locale: string, pref: DateFormat = 'auto'): DatePattern {
  if (pref === 'DD.MM.YYYY') return { order: ['day', 'month', 'year'], sep: '.' };
  if (pref === 'MM/DD/YYYY') return { order: ['month', 'day', 'year'], sep: '/' };
  if (pref === 'YYYY-MM-DD') return { order: ['year', 'month', 'day'], sep: '-' };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(
      new Date(2024, 10, 22),
    );
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(
      new Date(2024, 10, 22),
    );
  }
  const order = parts.filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year').map((p) => p.type as Field);
  const lit = parts.find((p) => p.type === 'literal')?.value.replace(/[‎‏\s]/g, '') || '.';
  return { order: order.length === 3 ? order : ['day', 'month', 'year'], sep: lit.charAt(0) || '.' };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const isoOf = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validYMD(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || y < 1000 || y > 9999) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function formatIsoDate(iso: string, p: DatePattern): string {
  const m = ISO_RE.exec(iso);
  if (!m) return '';
  const v: Record<Field, string> = { year: m[1]!, month: m[2]!, day: m[3]! };
  return p.order.map((f) => v[f]).join(p.sep);
}

/** Parse typed text in the locale's field order; also accepts ISO and two-digit years. Returns '' when empty, null when invalid. */
export function parseDateText(text: string, p: DatePattern, now: Date = new Date()): string | null {
  const s = text.trim();
  if (!s) return '';
  const iso = ISO_RE.exec(s);
  if (iso) {
    const [y, mo, d] = [+iso[1]!, +iso[2]!, +iso[3]!];
    return validYMD(y, mo, d) ? isoOf(y, mo, d) : null;
  }
  let nums = s.split(/[^\d]+/).filter(Boolean);
  if (nums.length === 1 && /^\d{6}$|^\d{8}$/.test(nums[0]!)) {
    const raw = nums[0]!;
    nums = p.order.map(() => '');
    let i = 0;
    for (const [k, f] of p.order.entries()) {
      const w = f === 'year' ? raw.length - 4 : 2;
      nums[k] = raw.slice(i, i + w);
      i += w;
    }
  }
  if (nums.length === 2) nums.splice(p.order.indexOf('year'), 0, String(now.getFullYear()));
  if (nums.length !== 3) return null;
  const v = {} as Record<Field, number>;
  p.order.forEach((f, i) => (v[f] = Number(nums[i])));
  if (String(v.year).length <= 2 && nums[p.order.indexOf('year')]!.length <= 2) v.year += 2000;
  return validYMD(v.year, v.month, v.day) ? isoOf(v.year, v.month, v.day) : null;
}

function firstDayOfWeek(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info) return info.firstDay % 7;
  } catch {
    /* fall through */
  }
  return /^en-(US|CA)|^ja|^ko|^zh|^pt-BR|^he|^ar/.test(locale) ? 0 : 1;
}

export interface DateFieldChange {
  target: { value: string; name?: string };
}

export interface DateFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'defaultValue' | 'min' | 'max'> {
  /** ISO yyyy-mm-dd or '' */
  value: string | null | undefined;
  onChange?: (e: DateFieldChange) => void;
  min?: string;
  max?: string;
}

/**
 * Date input that shows and accepts dates in the app language's order instead
 * of the OS locale a native `type="date"` follows. Value in and out is ISO.
 */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { value, onChange, min, max, className, disabled, readOnly, name, id, onBlur, onKeyDown, ...rest },
  ref,
) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const pref = usePreferencesStore((s) => s.dateFormat);
  const pattern = useMemo(() => datePatternFor(locale, pref), [locale, pref]);
  const iso = value ?? '';
  const [text, setText] = useState(() => formatIsoDate(iso, pattern));
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popId = useId();

  useEffect(() => {
    setText(formatIsoDate(iso, pattern));
    setInvalid(false);
  }, [iso, pattern]);

  const placeholder = useMemo(() => {
    const ph: Record<Field, string> = { day: 'dd', month: 'mm', year: 'yyyy' };
    return pattern.order.map((f) => ph[f]).join(pattern.sep);
  }, [pattern]);

  const inRange = (v: string) => (!min || v >= min) && (!max || v <= max);

  const emit = (v: string) => onChange?.({ target: { value: v, name } });

  const commit = () => {
    const parsed = parseDateText(text, pattern);
    if (parsed === null || (parsed && !inRange(parsed))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(formatIsoDate(parsed, pattern));
    if (parsed !== iso) emit(parsed);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Enter') {
      // A changed value is committed first; the next Enter submits the surrounding form with it.
      if (text !== formatIsoDate(iso, pattern)) {
        e.preventDefault();
        commit();
      }
    }
    else if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative inline-flex w-full min-w-[8.5rem] items-center">
      <input
        {...rest}
        ref={ref}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        readOnly={readOnly}
        placeholder={placeholder}
        aria-invalid={invalid || rest['aria-invalid'] || undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onBlur={(e) => {
          commit();
          onBlur?.(e);
        }}
        onKeyDown={handleKey}
        title={invalid ? t('datefield.invalid', { defaultValue: 'Enter a date as {{pattern}}', pattern: placeholder }) : rest.title}
        className={clsx(className, 'w-full pe-8 tabular-nums', invalid && '!border-semantic-error')}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled || readOnly}
        aria-label={t('datefield.open_calendar', { defaultValue: 'Open calendar' })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-content-tertiary hover:text-content-primary disabled:opacity-40"
      >
        <Calendar size={14} aria-hidden="true" />
      </button>
      {open && (
        <CalendarPopup
          id={popId}
          locale={locale}
          value={iso}
          min={min}
          max={max}
          onPick={(v) => {
            setOpen(false);
            setText(formatIsoDate(v, pattern));
            setInvalid(false);
            if (v !== iso) emit(v);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
});

interface PopupProps {
  id: string;
  locale: string;
  value: string;
  min?: string;
  max?: string;
  onPick: (iso: string) => void;
  onClose: () => void;
}

function CalendarPopup({ id, locale, value, min, max, onPick, onClose }: PopupProps) {
  const { t } = useTranslation();
  const today = new Date();
  const todayIso = isoOf(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const [focus, setFocus] = useState(() => (ISO_RE.test(value) ? value : todayIso));
  const gridRef = useRef<HTMLDivElement>(null);
  const [fy, fm] = [Number(focus.slice(0, 4)), Number(focus.slice(5, 7))];
  const firstDay = firstDayOfWeek(locale);

  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(fy, fm - 1, 1));
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2024, 0, 7 + ((firstDay + i) % 7))),
  );
  const lead = (new Date(fy, fm - 1, 1).getDay() - firstDay + 7) % 7;
  const daysIn = new Date(fy, fm, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];

  const shift = (days: number) => {
    const d = new Date(fy, fm - 1, Number(focus.slice(8, 10)) + days);
    setFocus(isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  };
  const shiftMonth = (n: number) => {
    const d = new Date(fy, fm - 1 + n, 1);
    const day = Math.min(Number(focus.slice(8, 10)), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
    setFocus(isoOf(d.getFullYear(), d.getMonth() + 1, day));
  };
  const allowed = (v: string) => (!min || v >= min) && (!max || v <= max);

  useEffect(() => {
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`)?.focus();
  }, [focus]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const map: Record<string, () => void> = {
      ArrowLeft: () => shift(-1),
      ArrowRight: () => shift(1),
      ArrowUp: () => shift(-7),
      ArrowDown: () => shift(7),
      PageUp: () => shiftMonth(-1),
      PageDown: () => shiftMonth(1),
      Escape: onClose,
    };
    const fn = map[e.key];
    if (fn) {
      e.preventDefault();
      e.stopPropagation();
      fn();
    }
  };

  const fmtFull = new Intl.DateTimeFormat(locale, { dateStyle: 'full' });

  return (
    <div
      id={id}
      role="dialog"
      aria-label={monthLabel}
      onKeyDown={onKey}
      className="absolute start-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-surface-elevated p-2 shadow-lg"
    >
      <div className="mb-1 flex items-center justify-between">
        <button type="button" aria-label={t('datefield.prev_month', { defaultValue: 'Previous month' })} onClick={() => shiftMonth(-1)} className="rounded p-1 hover:bg-surface-secondary">
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <span className="text-sm font-medium capitalize text-content-primary" aria-live="polite">
          {monthLabel}
        </span>
        <button type="button" aria-label={t('datefield.next_month', { defaultValue: 'Next month' })} onClick={() => shiftMonth(1)} className="rounded p-1 hover:bg-surface-secondary">
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      <div ref={gridRef} role="grid" className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {weekdays.map((w, i) => (
          <span key={i} role="columnheader" className="py-1 text-content-tertiary">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const v = isoOf(fy, fm, d);
          const selected = v === value;
          return (
            <button
              key={v}
              type="button"
              role="gridcell"
              data-iso={v}
              tabIndex={v === focus ? 0 : -1}
              disabled={!allowed(v)}
              aria-selected={selected}
              aria-label={fmtFull.format(new Date(fy, fm - 1, d))}
              onClick={() => onPick(v)}
              className={clsx(
                'rounded py-1 tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-oe-blue',
                selected ? 'bg-oe-blue text-white' : 'hover:bg-surface-secondary text-content-primary',
                v === todayIso && !selected && 'font-semibold text-oe-blue',
                'disabled:opacity-30',
              )}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default DateField;
