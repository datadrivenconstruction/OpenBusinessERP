/** Charts of the business home. Colours come from theme CSS vars, so light and dark follow the app. */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { MoneyDisplay } from '@/shared/ui';
import { BUCKETS, type Bucket } from '@/features/receivables/api';
import { num } from './homeUtils';

export const PALETTE = {
  revenue: 'var(--oe-blue)',
  expense: 'var(--oe-warning)',
  net: 'var(--oe-success)',
  danger: 'var(--oe-error)',
} as const;

const AXIS_TICK = { fontSize: 11, fill: 'currentColor', opacity: 0.55 };

interface TipRow { name: string; value: number; color: string }
function ChartTip({ title, rows, fmt }: { title: string; rows: TipRow[]; fmt: (v: number) => string }) {
  return (
    <div className="min-w-[160px] rounded-xl border border-border-light bg-surface-elevated px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-semibold text-content-primary">{title}</p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center justify-between gap-4 py-0.5 text-content-secondary">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: r.color }} />{r.name}</span>
          <span className="font-medium tabular-nums text-content-primary">{fmt(r.value)}</span>
        </p>
      ))}
    </div>
  );
}

export interface MonthPoint { month: string; label: string; revenue: number; expenses: number; net: number; current: boolean }

export function RevenueExpenseChart({ data, fmt }: { data: MonthPoint[]; fmt: (v: number, compact?: boolean) => string }) {
  const { t } = useTranslation();
  const names = {
    revenue: t('home.biz_revenue', { defaultValue: 'Revenue' }),
    expenses: t('home.biz_expenses', { defaultValue: 'Expenses (bills)' }),
    net: t('home.biz_net', { defaultValue: 'Net' }),
  };
  return (
    <div className="h-64 text-content-primary" data-testid="biz-revenue-chart" role="img"
      aria-label={t('home.biz_chart_aria', { defaultValue: 'Monthly revenue, expenses and net result' })}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} barGap={3}>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
          <YAxis width={64} tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={(v: number) => fmt(v, true)} />
          <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.2} />
          <Tooltip
            cursor={{ fill: 'currentColor', fillOpacity: 0.04 }}
            content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload as MonthPoint | undefined;
              if (!p) return null;
              return <ChartTip title={p.month} fmt={fmt} rows={[
                { name: names.revenue, value: p.revenue, color: PALETTE.revenue },
                { name: names.expenses, value: p.expenses, color: PALETTE.expense },
                { name: names.net, value: p.net, color: PALETTE.net },
              ]} />;
            }}
          />
          <Bar dataKey="revenue" name={names.revenue} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.month} fill={PALETTE.revenue} fillOpacity={d.current ? 1 : 0.55} />)}
          </Bar>
          <Bar dataKey="expenses" name={names.expenses} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.month} fill={PALETTE.expense} fillOpacity={d.current ? 0.9 : 0.4} />)}
          </Bar>
          <Line dataKey="net" name={names.net} type="monotone" stroke={PALETTE.net} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface ForecastPoint { day: number; date: string; balance: number; inflow: number; outflow: number }

export function CashForecastChart({ data, fmt, locale }: { data: ForecastPoint[]; fmt: (v: number, compact?: boolean) => string; locale: string }) {
  const { t } = useTranslation();
  const dipsBelowZero = data.some((d) => d.balance < 0);
  const color = dipsBelowZero ? PALETTE.danger : PALETTE.revenue;
  const label = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return (
    <div className="h-48 text-content-primary" data-testid="biz-forecast-chart" role="img"
      aria-label={t('home.biz_forecast_aria', { defaultValue: 'Expected cash balance by day' })}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="bizForecast" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} /><stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={label} minTickGap={28} />
          <YAxis width={64} tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={(v: number) => fmt(v, true)} />
          <ReferenceLine y={0} stroke={PALETTE.danger} strokeOpacity={0.5} strokeDasharray="4 4" />
          <Tooltip content={({ active, payload }) => {
            const p = active && payload?.[0]?.payload as ForecastPoint | undefined;
            if (!p) return null;
            return <ChartTip title={label(p.date)} fmt={fmt} rows={[
              { name: t('home.biz_balance', { defaultValue: 'Balance' }), value: p.balance, color },
              ...(p.inflow ? [{ name: t('home.biz_cash_in', { defaultValue: 'Money in' }), value: p.inflow, color: PALETTE.net }] : []),
              ...(p.outflow ? [{ name: t('home.biz_cash_out', { defaultValue: 'Money out' }), value: p.outflow, color: PALETTE.expense }] : []),
            ]} />;
          }} />
          <Area dataKey="balance" type="stepAfter" stroke={color} strokeWidth={2} fill="url(#bizForecast)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const BUCKET_CLS: Record<Bucket, string> = {
  current: 'bg-semantic-success/70',
  d1_30: 'bg-semantic-warning/50',
  d31_60: 'bg-semantic-warning/80',
  d61_90: 'bg-semantic-error/60',
  d90_plus: 'bg-semantic-error',
};

export function AgingBar({ totals, currency }: { totals: Partial<Record<Bucket | 'total', string>>; currency: string }) {
  const { t } = useTranslation();
  const label: Record<Bucket, string> = {
    current: t('home.biz_bucket_current', { defaultValue: 'Not yet due' }),
    d1_30: t('home.biz_bucket_1_30', { defaultValue: '1–30 days' }),
    d31_60: t('home.biz_bucket_31_60', { defaultValue: '31–60 days' }),
    d61_90: t('home.biz_bucket_61_90', { defaultValue: '61–90 days' }),
    d90_plus: t('home.biz_bucket_90', { defaultValue: '90+ days' }),
  };
  const total = BUCKETS.reduce((s, b) => s + Math.max(0, num(totals[b])), 0);
  return (
    <div data-testid="biz-aging-bar">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-surface-secondary">
        {BUCKETS.map((b) => {
          const v = Math.max(0, num(totals[b]));
          if (!v || !total) return null;
          return (
            <Link key={b} to={`/receivables?bucket=${b}`} style={{ width: `${(v / total) * 100}%` }} title={label[b]}
              aria-label={label[b]} className={`${BUCKET_CLS[b]} transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue`} />
          );
        })}
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {BUCKETS.map((b) => {
          const v = num(totals[b]);
          return (
            <li key={b}>
              <Link to={`/receivables?bucket=${b}`} data-testid={`biz-aging-${b}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${BUCKET_CLS[b]}`} aria-hidden />
                <span className="flex-1 text-content-secondary">{label[b]}</span>
                <span className="font-medium tabular-nums text-content-primary"><MoneyDisplay amount={v} currency={currency} compact /></span>
                <span className="w-9 text-right tabular-nums text-content-tertiary">{total ? Math.round((Math.max(0, v) / total) * 100) : 0}%</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
