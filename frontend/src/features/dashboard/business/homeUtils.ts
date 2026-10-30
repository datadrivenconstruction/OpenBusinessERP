/** Pure helpers and the persisted card layout for the business home. */
import { useCallback, useState } from 'react';

export const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00`)) / 86_400_000);
}

/** Axis/tooltip formatter; cells use MoneyDisplay, charts need a plain string. */
export function makeMoney(currency: string | null | undefined, locale: string) {
  return (value: number, compact = false): string => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0,
        notation: compact || Math.abs(value) >= 1e6 ? 'compact' : 'standard',
      }).format(value);
    } catch {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
    }
  };
}

export function openAmount(d: { gross_total: string; amount_paid?: string; balance_due?: string }): number {
  return d.balance_due != null ? num(d.balance_due) : num(d.gross_total) - num(d.amount_paid);
}

export function pctChange(now: number, prev: number): number | null {
  return prev ? ((now - prev) / Math.abs(prev)) * 100 : null;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

export interface Flow { date: string; amount: number }

/** Daily running balance from today; flows dated before today land on day 0. */
export function forecastSeries(start: number, flows: Flow[], today: string, horizon: number) {
  const byDay = new Array<number>(horizon + 1).fill(0);
  const inflow = new Array<number>(horizon + 1).fill(0);
  const outflow = new Array<number>(horizon + 1).fill(0);
  for (const f of flows) {
    const d = Math.max(0, daysBetween(today, f.date));
    if (d > horizon) continue;
    byDay[d] = (byDay[d] ?? 0) + f.amount;
    if (f.amount >= 0) inflow[d] = (inflow[d] ?? 0) + f.amount; else outflow[d] = (outflow[d] ?? 0) + f.amount;
  }
  let bal = start;
  const base = new Date(`${today}T00:00:00`);
  return byDay.map((delta, i) => {
    bal += delta;
    return { day: i, date: isoDay(addDays(base, i)), balance: bal, inflow: inflow[i]!, outflow: outflow[i]! };
  });
}

/* ── card layout (hide / reorder), per browser ─────────────────────────────── */

export const LAYOUT_KEY = 'oe.bizHome.layout.v1';
export interface HomeLayout { order: string[]; hidden: string[] }

function readLayout(): HomeLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as Partial<HomeLayout> | null;
    return { order: Array.isArray(raw?.order) ? raw!.order : [], hidden: Array.isArray(raw?.hidden) ? raw!.hidden : [] };
  } catch {
    return { order: [], hidden: [] };
  }
}

export function useHomeLayout(defaults: string[]) {
  const [layout, setLayout] = useState<HomeLayout>(readLayout);
  const save = useCallback((next: HomeLayout) => {
    setLayout(next);
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  }, []);
  // Saved order first, then any card added since the user last arranged.
  const ordered = [...layout.order.filter((id) => defaults.includes(id)), ...defaults.filter((id) => !layout.order.includes(id))];
  const move = (id: string, dir: -1 | 1, within: string[]) => {
    const group = ordered.filter((x) => within.includes(x));
    const i = group.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= group.length) return;
    const a = group[i]!, b = group[j]!;
    save({ ...layout, order: ordered.map((x) => (x === a ? b : x === b ? a : x)) });
  };
  const toggle = (id: string) => save({
    ...layout,
    hidden: layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id],
  });
  const reset = () => save({ order: [], hidden: [] });
  return { ordered, hidden: new Set(layout.hidden), move, toggle, reset };
}
