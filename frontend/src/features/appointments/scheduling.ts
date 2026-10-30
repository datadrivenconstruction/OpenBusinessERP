/** Pure scheduling helpers: overlap lanes, KPIs, calendar files, mail drafts. */

import { addDays, dayKey, parseLocal, type Booking, type Service, type ServiceInput } from './api';

const OPEN: Booking['status'][] = ['requested', 'confirmed', 'checked_in'];
const BILLABLE: Booking['status'][] = ['requested', 'confirmed', 'checked_in', 'completed'];

/**
 * Side-by-side lanes for bookings that overlap in one column, so none hides
 * another. Returns lane index and lane count of the cluster per booking id.
 */
export function layoutLanes(items: Pick<Booking, 'id' | 'start_at' | 'end_at'>[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.start_at.localeCompare(b.start_at) || b.end_at.localeCompare(a.end_at));
  const out = new Map<string, { lane: number; lanes: number }>();
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: string[] = [];
  let clusterEnd = '';
  const flush = () => {
    for (const c of cluster) out.set(c.id, { lane: c.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.start_at >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= b.start_at);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(b.end_at);
    } else laneEnds[lane] = b.end_at;
    cluster.push({ id: b.id, lane });
    clusterEnd = cluster.length === 1 || b.end_at > clusterEnd ? b.end_at : clusterEnd;
  }
  flush();
  return out;
}

export interface BookingKpis {
  today: number;
  upcoming: number;
  requested: number;
  noShowRate: number | null;
  bookedValue: number;
  toInvoice: number;
  toInvoiceValue: number;
  currency: string;
}

/** Headline numbers for a set of bookings (prices come from the service catalogue). */
export function bookingKpis(bookings: Booking[], services: Service[], now = new Date()): BookingKpis {
  const price = new Map(services.map((s) => [s.id, Number(s.price) || 0]));
  const today = dayKey(now);
  const nowIso = `${today}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const weekEnd = dayKey(addDays(now, 7));
  let todayCount = 0, upcoming = 0, requested = 0, noShow = 0, attended = 0, booked = 0, toInvoice = 0, toInvoiceValue = 0;
  for (const b of bookings) {
    const day = b.start_at.slice(0, 10);
    if (day === today && b.status !== 'cancelled') todayCount += 1;
    if (OPEN.includes(b.status) && b.start_at >= nowIso && day < weekEnd) upcoming += 1;
    if (b.status === 'requested') requested += 1;
    if (b.status === 'no_show') noShow += 1;
    if (b.status === 'completed') attended += 1;
    if (BILLABLE.includes(b.status)) booked += price.get(b.service_id) ?? 0;
    if (b.status === 'completed' && !b.invoice_id) {
      toInvoice += 1;
      toInvoiceValue += price.get(b.service_id) ?? 0;
    }
  }
  return {
    today: todayCount,
    upcoming,
    requested,
    noShowRate: noShow + attended > 0 ? noShow / (noShow + attended) : null,
    bookedValue: booked,
    toInvoice,
    toInvoiceValue,
    currency: services.find((s) => s.active)?.currency ?? services[0]?.currency ?? 'EUR',
  };
}

/** Group ISO slot starts by their calendar day, keeping order. */
export function groupByDay(starts: string[]): [string, string[]][] {
  const m = new Map<string, string[]>();
  for (const s of starts) {
    const k = s.slice(0, 10);
    m.set(k, [...(m.get(k) ?? []), s]);
  }
  return [...m.entries()];
}

/** Split a day's slots into morning / afternoon / evening for an easier picker. */
export function partOfDay(iso: string): 'morning' | 'afternoon' | 'evening' {
  const h = parseLocal(iso).getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function icsStamp(iso: string): string {
  return iso.replace(/[-:]/g, '').slice(0, 15).padEnd(15, '0');
}

function icsEscape(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
}

/** Minimal iCalendar event in floating (business-local) time. */
export function icsEvent(e: { uid: string; title: string; start: string; end: string; description?: string }): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenERP//Appointments//EN',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${icsStamp(new Date().toISOString().slice(0, 19))}Z`,
    `DTSTART:${icsStamp(e.start)}`,
    `DTEND:${icsStamp(e.end)}`,
    `SUMMARY:${icsEscape(e.title)}`,
    ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/** ``mailto:`` link that opens the draft in the user's own mail client. */
export function mailtoHref(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Fields of a service form that differ from the stored service (sent as PATCH). */
export function servicePatch(form: ServiceInput, base: ServiceInput): Partial<ServiceInput> {
  const out: Partial<ServiceInput> = {};
  for (const k of Object.keys(form) as (keyof ServiceInput)[]) {
    if (JSON.stringify(form[k]) !== JSON.stringify(base[k])) (out as Record<string, unknown>)[k] = form[k];
  }
  return out;
}

/** Validation messages (as i18n keys + fallbacks) for a service form. */
export function serviceErrors(s: ServiceInput): [string, string][] {
  const e: [string, string][] = [];
  if (!s.name.trim()) e.push(['appointments.err_name', 'Enter a name.']);
  if (s.duration_min < 5) e.push(['appointments.err_duration', 'Duration must be at least 5 minutes.']);
  if (!(Number(s.price) >= 0)) e.push(['appointments.err_price', 'Price cannot be negative.']);
  if (!/^[A-Z]{3}$/.test(s.currency)) e.push(['appointments.err_currency', 'Use a 3-letter currency code.']);
  return e;
}

/** Total minutes a service occupies a resource, including buffers. */
export function blockMinutes(s: Pick<Service, 'duration_min' | 'buffer_before_min' | 'buffer_after_min'>): number {
  return s.duration_min + s.buffer_before_min + s.buffer_after_min;
}

// ── Weekly availability rules ───────────────────────────────────────────
type HoursRow = { weekday: number; start_min: number; end_min: number; kind: 'work' | 'break' };

/** Replace the rules of ``targets`` weekdays with a copy of ``from``'s rules. */
export function copyDay<T extends HoursRow>(rows: T[], from: number, targets: number[]): T[] {
  const src = rows.filter((r) => r.weekday === from);
  const kept = rows.filter((r) => r.weekday === from || !targets.includes(r.weekday));
  return [...kept, ...targets.filter((d) => d !== from).flatMap((d) => src.map((r) => ({ ...r, weekday: d })))];
}

/** Weekdays (0 = Monday) whose rules are invalid: end before start, or overlapping working ranges. */
export function invalidDays(rows: HoursRow[]): number[] {
  const bad = new Set<number>();
  for (let d = 0; d < 7; d += 1) {
    const day = rows.filter((r) => r.weekday === d);
    if (day.some((r) => r.end_min <= r.start_min)) bad.add(d);
    const work = day.filter((r) => r.kind === 'work').sort((a, b) => a.start_min - b.start_min);
    for (let i = 1; i < work.length; i += 1) if (work[i]!.start_min < work[i - 1]!.end_min) bad.add(d);
  }
  return [...bad].sort();
}

/** Bookable minutes per week (working time minus breaks inside it). */
export function weeklyMinutes(rows: HoursRow[]): number {
  let total = 0;
  for (const r of rows) total += (r.kind === 'work' ? 1 : -1) * Math.max(0, r.end_min - r.start_min);
  return Math.max(0, total);
}

/** Every date from ``from`` to ``to`` inclusive (YYYY-MM-DD), capped at 62 days. */
export function dateRange(from: string, to: string): string[] {
  if (!from) return [];
  const out: string[] = [];
  const end = to && to >= from ? to : from;
  let d = parseLocal(from);
  while (dayKey(d) <= end && out.length < 62) {
    out.push(dayKey(d));
    d = addDays(d, 1);
  }
  return out;
}
