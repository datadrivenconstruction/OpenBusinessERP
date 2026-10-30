/** API helpers for the Appointments module, backed by /api/v1/appointments/. */

import { API_BASE, apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/shared/lib/api';

const B = '/v1/appointments';

export type ResourceKind = 'staff' | 'room' | 'chair' | 'equipment';
export const RESOURCE_KINDS: ResourceKind[] = ['staff', 'room', 'chair', 'equipment'];
export type BookingStatus = 'requested' | 'confirmed' | 'checked_in' | 'completed' | 'no_show' | 'cancelled';
export const STATUSES: BookingStatus[] = ['requested', 'confirmed', 'checked_in', 'completed', 'no_show', 'cancelled'];

/** Next statuses a booking may move to (mirrors the backend transitions). */
export const NEXT_STATUS: Record<BookingStatus, BookingStatus[]> = {
  requested: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'completed', 'no_show', 'cancelled'],
  checked_in: ['completed', 'no_show'],
  completed: [],
  no_show: ['confirmed'],
  cancelled: [],
};

export const STATUS_VARIANT: Record<BookingStatus, 'neutral' | 'blue' | 'purple' | 'success' | 'warning' | 'error'> = {
  requested: 'warning',
  confirmed: 'blue',
  checked_in: 'purple',
  completed: 'success',
  no_show: 'error',
  cancelled: 'neutral',
};

export const STATUS_LABEL: Record<BookingStatus, string> = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};

export const KIND_LABEL: Record<ResourceKind, string> = {
  staff: 'Staff member',
  room: 'Room',
  chair: 'Chair',
  equipment: 'Equipment',
};

export interface AppointmentSettings {
  public_title: string;
  online_enabled: boolean;
  slug: string;
  auto_confirm: boolean;
  privacy_url: string;
  slot_step_min: number;
  min_notice_hours: number;
  max_days_ahead: number;
  retention_days: number;
  reminders_enabled: boolean;
  reminder_hours: number;
  timezone: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  duration_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
  price: string;
  currency: string;
  item_id: string | null;
  resource_kind: ResourceKind;
  resource_ids: string[];
  color: string;
  online: boolean;
  active: boolean;
}
export type ServiceInput = Omit<Service, 'id'>;

export interface Resource {
  id: string;
  name: string;
  kind: ResourceKind;
  color: string;
  active: boolean;
  sort_order: number;
}
export type ResourceInput = Omit<Resource, 'id'>;

export interface Hours {
  id?: string;
  weekday: number;
  start_min: number;
  end_min: number;
  kind: 'work' | 'break';
}

export interface HoursException {
  id: string;
  resource_id: string;
  day: string;
  kind: 'closed' | 'open';
  start_min: number | null;
  end_min: number | null;
  label: string;
}

export interface Booking {
  id: string;
  service_id: string;
  resource_id: string;
  contact_id: string | null;
  client_name: string;
  client_email: string;
  client_phone: string;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  source: 'staff' | 'online';
  notes: string;
  consent_at: string | null;
  series_id: string | null;
  invoice_id: string | null;
}

export interface BookingInput {
  service_id: string;
  start_at: string;
  resource_id?: string | null;
  contact_id?: string | null;
  create_contact?: boolean;
  client_name?: string;
  client_email?: string;
  client_phone?: string;
  notes?: string;
  status?: 'requested' | 'confirmed';
  repeat_weeks?: number;
}

export interface Slot {
  start_at: string;
  resource_id: string;
}

export interface Reminder {
  id: string;
  booking_id: string;
  channel: string;
  recipient: string;
  due_at: string;
  status: ReminderStatus;
  detail: string;
}
export type ReminderStatus = 'queued' | 'draft' | 'sent' | 'skipped' | 'failed';

/** A reminder rendered as plain text; staff send it themselves (never auto-sent). */
export interface ReminderDraft {
  id: string;
  booking_id: string;
  recipient: string;
  status: ReminderStatus;
  subject: string;
  body: string;
  client_name: string;
  start_at: string;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const appointmentsApi = {
  settings: () => apiGet<AppointmentSettings>(`${B}/settings/`),
  updateSettings: (body: Partial<AppointmentSettings>) => apiPatch<AppointmentSettings>(`${B}/settings/`, body),
  regenerateLink: () => apiPost<AppointmentSettings>(`${B}/settings/regenerate-link/`, {}),
  services: () => apiGet<Service[]>(`${B}/services/`),
  createService: (body: ServiceInput) => apiPost<Service>(`${B}/services/`, body),
  updateService: (id: string, body: Partial<ServiceInput>) => apiPatch<Service>(`${B}/services/${id}/`, body),
  removeService: (id: string) => apiDelete(`${B}/services/${id}/`),
  resources: () => apiGet<Resource[]>(`${B}/resources/`),
  createResource: (body: ResourceInput & { hours?: Hours[] }) => apiPost<Resource>(`${B}/resources/`, body),
  updateResource: (id: string, body: Partial<ResourceInput>) => apiPatch<Resource>(`${B}/resources/${id}/`, body),
  removeResource: (id: string) => apiDelete(`${B}/resources/${id}/`),
  hours: (id: string) => apiGet<Hours[]>(`${B}/resources/${id}/hours/`),
  setHours: (id: string, hours: Hours[]) => apiPut<Hours[]>(`${B}/resources/${id}/hours/`, hours),
  exceptions: (id: string) => apiGet<HoursException[]>(`${B}/resources/${id}/exceptions/`),
  addException: (id: string, body: Omit<HoursException, 'id' | 'resource_id'>) =>
    apiPost<HoursException>(`${B}/resources/${id}/exceptions/`, body),
  removeException: (id: string) => apiDelete(`${B}/exceptions/${id}/`),
  availability: (p: { service_id: string; from_date?: string; days?: number; resource_id?: string; limit?: number }) =>
    apiGet<Slot[]>(`${B}/availability/${qs(p)}`),
  bookings: (p: { start?: string; end?: string; resource_id?: string; status?: string } = {}) =>
    apiGet<Booking[]>(`${B}/bookings/${qs(p)}`),
  createBooking: (body: BookingInput) => apiPost<Booking[]>(`${B}/bookings/`, body),
  updateBooking: (id: string, body: Partial<BookingInput>) => apiPatch<Booking>(`${B}/bookings/${id}/`, body),
  setStatus: (id: string, status: BookingStatus) => apiPost<Booking>(`${B}/bookings/${id}/status/`, { status }),
  removeBooking: (id: string) => apiDelete(`${B}/bookings/${id}/`),
  createInvoice: (id: string) =>
    apiPost<{ invoice_id: string; number: string; gross_total: string }>(`${B}/bookings/${id}/invoice/`, {}),
  clientBookings: (email: string) => apiGet<Booking[]>(`${B}/clients/bookings/${qs({ email })}`),
  eraseClient: (email: string) => apiDelete<{ count: number }>(`${B}/clients/bookings/${qs({ email })}`),
  purge: () => apiPost<{ count: number }>(`${B}/retention/purge/`, {}),
  reminders: () => apiGet<Reminder[]>(`${B}/reminders/`),
  prepareReminders: () => apiPost<{ draft: number; skipped: number }>(`${B}/reminders/prepare/`, {}),
  reminderDraft: (id: string) => apiGet<ReminderDraft>(`${B}/reminders/${id}/draft/`),
  markReminder: (id: string, status: 'sent' | 'skipped') =>
    apiPost<Reminder>(`${B}/reminders/${id}/mark/`, { status }),
  draftReminderFor: (bookingId: string) => apiPost<Reminder>(`${B}/bookings/${bookingId}/reminder/`, {}),
};

// ── Public booking page (no login) ──────────────────────────────────────
export interface PublicService {
  id: string;
  name: string;
  description: string;
  duration_min: number;
  price: string;
  currency: string;
}
export interface PublicProfile {
  title: string;
  privacy_url: string;
  max_days_ahead: number;
  services: PublicService[];
}
export interface PublicBookingResult {
  status: BookingStatus;
  service_name: string;
  start_at: string;
  end_at: string;
  cancel_token: string;
}
export interface PublicBookingView {
  status: BookingStatus;
  service_name: string;
  title: string;
  start_at: string;
  end_at: string;
  can_cancel: boolean;
}

async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${B}/public/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') msg = body.detail;
    } catch {
      /* keep status text */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const publicApi = {
  profile: (slug: string) => publicFetch<PublicProfile>(`${encodeURIComponent(slug)}/`),
  slots: (slug: string, serviceId: string, fromDate: string, days = 7) =>
    publicFetch<{ start_at: string }[]>(
      `${encodeURIComponent(slug)}/slots/${qs({ service_id: serviceId, from_date: fromDate, days })}`,
    ),
  book: (
    slug: string,
    body: { service_id: string; start_at: string; name: string; email: string; phone: string; note: string; consent: boolean; website: string },
  ) => publicFetch<PublicBookingResult>(`${encodeURIComponent(slug)}/bookings/`, { method: 'POST', body: JSON.stringify(body) }),
  view: (token: string) => publicFetch<PublicBookingView>(`booking/${encodeURIComponent(token)}/`),
  cancel: (token: string) =>
    publicFetch<PublicBookingView>(`booking/${encodeURIComponent(token)}/cancel/`, { method: 'POST' }),
};

// ── Pure helpers ────────────────────────────────────────────────────────
export function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hhmmToMin(v: string): number {
  const [h, m] = v.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Local wall-clock ISO without zone (the backend stores business-local times). */
export function toLocalIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

export function dayKey(d: Date): string {
  return toLocalIso(d).slice(0, 10);
}

export function parseLocal(iso: string): Date {
  const [d, t = '00:00'] = iso.replace('Z', '').split('T');
  const [y = 0, mo = 1, da = 1] = (d ?? '').split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(y, mo - 1, da, h || 0, mi || 0);
}

export function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Vertical placement of a booking in a day column, in minutes from ``dayStartMin``. */
export function placement(b: Pick<Booking, 'start_at' | 'end_at'>, dayStartMin: number, dayEndMin: number) {
  const s = parseLocal(b.start_at);
  const e = parseLocal(b.end_at);
  const sm = s.getHours() * 60 + s.getMinutes();
  const em = e.getDate() !== s.getDate() ? 1440 : e.getHours() * 60 + e.getMinutes();
  const top = Math.max(sm, dayStartMin) - dayStartMin;
  const bottom = Math.min(em, dayEndMin) - dayStartMin;
  return { top, height: Math.max(bottom - top, 10) };
}

/** Snap a minute offset to a grid step. */
export function snap(min: number, step: number): number {
  return Math.round(min / step) * step;
}

/** Iframe snippet for embedding the public booking page on another site. */
export function embedSnippet(origin: string, slug: string): string {
  return `<iframe src="${origin}/book/${slug}" title="Online booking" style="width:100%;min-height:720px;border:0" loading="lazy"></iframe>`;
}
