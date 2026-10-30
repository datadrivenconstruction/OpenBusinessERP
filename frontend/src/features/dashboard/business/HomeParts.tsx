/** Visual building blocks of the business home: card shell, tiles, deltas, sparklines. */
import { Component, useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { fmtPercent, fmtNumberForInput } from '@/shared/lib/formatters';

export type Tone = 'ok' | 'warn' | 'danger' | 'neutral';

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-semantic-success', warn: 'text-semantic-warning', danger: 'text-semantic-error', neutral: 'text-content-tertiary',
};
export const TONE_PILL: Record<Tone, string> = {
  ok: 'bg-semantic-success/10 text-semantic-success',
  warn: 'bg-semantic-warning/10 text-semantic-warning',
  danger: 'bg-semantic-error/10 text-semantic-error',
  neutral: 'bg-surface-secondary text-content-secondary',
};
const TONE_BAR: Record<Tone, string> = {
  ok: 'bg-semantic-success', warn: 'bg-semantic-warning', danger: 'bg-semantic-error', neutral: 'bg-border',
};

/** One card's render error stays inside that card. */
export class CardBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-secondary ${className}`} aria-hidden />;
}

export function Lines({ n = 3 }: { n?: number }) {
  return (
    <div className="space-y-3 py-1" aria-busy="true">
      {Array.from({ length: n }, (_, i) => <Skeleton key={i} className="h-4" />)}
    </div>
  );
}

export function CardError({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border-light px-3 py-2.5 text-xs text-content-secondary" role="alert">
      <span>{t('home.biz_card_error', { defaultValue: 'Could not load this section.' })}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded font-medium text-oe-blue hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue">
          {t('home.biz_retry', { defaultValue: 'Retry' })}
        </button>
      )}
    </div>
  );
}

export function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="group/link inline-flex items-center gap-0.5 rounded text-xs font-medium text-oe-blue hover:text-oe-blue/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue">
      {children}<ChevronRight className="h-3.5 w-3.5 transition-transform group-hover/link:translate-x-0.5" />
    </Link>
  );
}

export interface CustomizeControls { onUp?: () => void; onDown?: () => void; onToggle: () => void; hidden: boolean }

export function HomeCard({ title, subtitle, action, children, testId, className = '', customize }: {
  title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode;
  testId?: string; className?: string; customize?: CustomizeControls;
}) {
  const { t } = useTranslation();
  const hid = useId();
  const btn = 'flex h-7 w-7 items-center justify-center rounded-md border border-border-light text-content-secondary hover:bg-surface-secondary disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue';
  return (
    <section
      aria-labelledby={hid}
      data-testid={testId}
      className={`flex min-w-0 flex-col rounded-2xl border border-border-light bg-surface-elevated shadow-xs transition-shadow hover:shadow-sm ${customize?.hidden ? 'opacity-50' : ''} ${className}`}
    >
      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h2 id={hid} className="text-[13px] font-semibold tracking-tight text-content-primary">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-content-tertiary">{subtitle}</p>}
        </div>
        {customize ? (
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" className={btn} onClick={customize.onUp} disabled={!customize.onUp} aria-label={t('home.biz_move_up', { defaultValue: 'Move up' })}><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" className={btn} onClick={customize.onDown} disabled={!customize.onDown} aria-label={t('home.biz_move_down', { defaultValue: 'Move down' })}><ArrowDown className="h-3.5 w-3.5" /></button>
            <button type="button" className={btn} onClick={customize.onToggle} aria-pressed={customize.hidden}
              aria-label={customize.hidden ? t('home.biz_show_card', { defaultValue: 'Show card' }) : t('home.biz_hide_card', { defaultValue: 'Hide card' })}>
              {customize.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        ) : action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="flex-1 px-5 pb-5">
        <CardBoundary fallback={<CardError />}>{children}</CardBoundary>
      </div>
    </section>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-surface-secondary p-0.5">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue ${o.value === value ? 'bg-surface-elevated text-content-primary shadow-xs' : 'text-content-tertiary hover:text-content-primary'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Delta({ pct, goodWhenUp = true }: { pct: number | null; goodWhenUp?: boolean }) {
  const { t } = useTranslation();
  if (pct === null || !Number.isFinite(pct)) return null;
  const up = pct >= 0;
  const good = up === goodWhenUp;
  const label = t('home.biz_vs_last_month', { defaultValue: 'vs last month' });
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${good ? TONE_PILL.ok : TONE_PILL.danger}`} title={label}>
      <span aria-hidden>{up ? '↑' : '↓'}</span>{fmtPercent(Math.abs(pct), 0)}<span className="sr-only"> {label}</span>
    </span>
  );
}

export function Sparkline({ values, className = 'text-oe-blue', width = 88, height = 28 }: {
  values: number[]; className?: string; width?: number; height?: number;
}) {
  const gid = useId().replace(/:/g, '');
  if (values.length < 2 || values.every((v) => v === values[0])) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const xy = values.map((v, i) => [(i / (values.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const pts = xy.map(([x, y]) => `${fmtNumberForInput(x, 1)},${fmtNumberForInput(y, 1)}`).join(' ');
  const [lx, ly] = xy[xy.length - 1]!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} aria-hidden data-testid="biz-sparkline">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity={0.22} /><stop offset="100%" stopColor="currentColor" stopOpacity={0} /></linearGradient></defs>
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill={`url(#${gid})`} />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.4} fill="currentColor" />
    </svg>
  );
}

export function KpiTile({ label, to, loading, error, onRetry, value, delta, context, why, empty, tone = 'neutral', spark }: {
  label: string; to: string; loading: boolean; error: boolean; onRetry: () => void;
  value: ReactNode | null; delta?: ReactNode; context?: ReactNode; why: string; empty?: ReactNode;
  tone?: Tone; spark?: number[];
}) {
  return (
    <Link to={to} data-testid="biz-kpi" data-tone={tone}
      className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border-light bg-surface-elevated p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oe-blue">
      <span className={`absolute inset-x-0 top-0 h-0.5 ${TONE_BAR[tone]}`} aria-hidden />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-content-secondary">{label}</span>
        <ChevronRight className="h-4 w-4 text-content-tertiary opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </div>
      {loading ? (
        <div className="mt-3 space-y-2"><Skeleton className="h-7 w-28" /><Skeleton className="h-3 w-36" /></div>
      ) : error ? (
        <div className="mt-2" onClick={(e) => { e.preventDefault(); onRetry(); }}><CardError onRetry={onRetry} /></div>
      ) : value === null ? (
        <div className="mt-2 text-sm text-content-tertiary">{empty}</div>
      ) : (
        <>
          <div className="mt-2 flex items-end justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-2xl font-semibold leading-tight tracking-tight tabular-nums text-content-primary">{value}</span>
              {delta}
            </div>
            {spark && <Sparkline values={spark} width={72} height={26} className={tone === 'danger' ? 'text-semantic-error' : 'text-oe-blue'} />}
          </div>
          {context && <div className={`mt-1 truncate text-xs ${TONE_TEXT[tone]}`}>{context}</div>}
        </>
      )}
      <p className="mt-auto pt-3 text-[11px] leading-snug text-content-tertiary">{why}</p>
    </Link>
  );
}
