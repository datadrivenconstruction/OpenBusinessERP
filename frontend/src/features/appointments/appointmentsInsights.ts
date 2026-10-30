/**
 * Appointments' contribution to the Module Insights panel: bookings of the
 * loaded window (60 days back and ahead) as one dataset with built-in KPIs and
 * charts. Booking value comes from the service catalogue price.
 */
import { useTranslation } from 'react-i18next';
import type { InsightDataset, InsightDef } from '@/features/insights';
import { STATUS_LABEL, parseLocal, type Booking, type Resource, type Service } from './api';

type Translate = ReturnType<typeof useTranslation>['t'];
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function buildAppointmentsInsights(
  bookings: Booking[],
  services: Service[],
  resources: Resource[],
  t: Translate,
): { datasets: InsightDataset[]; builtins: InsightDef[] } {
  const svc = new Map(services.map((s) => [s.id, s]));
  const res = new Map(resources.map((r) => [r.id, r.name]));
  const currency = services[0]?.currency ?? '';
  const rows = [...bookings]
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((b) => {
      const s = svc.get(b.service_id);
      const d = parseLocal(b.start_at);
      const live = b.status !== 'cancelled' && b.status !== 'no_show';
      return {
        service: s?.name ?? '—',
        resource: res.get(b.resource_id) ?? '—',
        status: t(`appointments.status_${b.status}`, { defaultValue: STATUS_LABEL[b.status] }),
        source: b.source === 'online' ? t('appointments.source_online', { defaultValue: 'Online' }) : t('appointments.source_staff', { defaultValue: 'Staff' }),
        weekday: `${(d.getDay() + 6) % 7} ${t(`appointments.wd_${(d.getDay() + 6) % 7}`, { defaultValue: WD[(d.getDay() + 6) % 7] })}`,
        week: b.start_at.slice(0, 10),
        value: live ? Number(s?.price ?? 0) || 0 : 0,
        minutes: live ? s?.duration_min ?? 0 : 0,
        no_show: b.status === 'no_show' ? 1 : 0,
        online: b.source === 'online' ? 1 : 0,
      };
    });

  const dataset: InsightDataset = {
    id: 'bookings',
    label: t('appointments.insights.ds', { defaultValue: 'Bookings (±60 days)' }),
    currency,
    fields: [
      { key: 'service', label: t('appointments.service', { defaultValue: 'Service' }), kind: 'dimension' },
      { key: 'resource', label: t('appointments.resource', { defaultValue: 'Resource' }), kind: 'dimension' },
      { key: 'status', label: t('appointments.status', { defaultValue: 'Status' }), kind: 'dimension' },
      { key: 'source', label: t('appointments.insights.f_source', { defaultValue: 'Channel' }), kind: 'dimension' },
      { key: 'weekday', label: t('appointments.insights.f_weekday', { defaultValue: 'Weekday' }), kind: 'dimension' },
      { key: 'week', label: t('appointments.insights.f_day', { defaultValue: 'Day' }), kind: 'dimension' },
      { key: 'value', label: t('appointments.insights.f_value', { defaultValue: 'Booked value' }), kind: 'measure', format: 'currency' },
      { key: 'minutes', label: t('appointments.insights.f_minutes', { defaultValue: 'Booked minutes' }), kind: 'measure', format: 'number' },
      { key: 'no_show', label: t('appointments.insights.f_no_show', { defaultValue: 'No-shows' }), kind: 'measure', format: 'number' },
      { key: 'online', label: t('appointments.insights.f_online', { defaultValue: 'Online bookings' }), kind: 'measure', format: 'number' },
    ],
    rows,
  };
  const base = { datasetId: 'bookings', builtin: true } as const;
  const builtins: InsightDef[] = [
    { ...base, id: 'kpi-bookings', title: t('appointments.insights.k_bookings', { defaultValue: 'Bookings' }), chart: 'kpi', agg: 'count', color: 0 },
    { ...base, id: 'kpi-value', title: t('appointments.insights.f_value', { defaultValue: 'Booked value' }), chart: 'kpi', measure: 'value', agg: 'sum', color: 2 },
    { ...base, id: 'kpi-online', title: t('appointments.insights.f_online', { defaultValue: 'Online bookings' }), chart: 'kpi', measure: 'online', agg: 'sum', color: 4 },
    { ...base, id: 'kpi-no-show', title: t('appointments.insights.f_no_show', { defaultValue: 'No-shows' }), chart: 'kpi', measure: 'no_show', agg: 'sum', color: 1 },
    { ...base, id: 'bar-service', title: t('appointments.insights.c_service', { defaultValue: 'Value by service' }), chart: 'bar', dimension: 'service', measure: 'value', agg: 'sum', color: 0 },
    { ...base, id: 'bar-resource', title: t('appointments.insights.c_resource', { defaultValue: 'Booked minutes by resource' }), chart: 'bar', dimension: 'resource', measure: 'minutes', agg: 'sum', color: 2 },
    { ...base, id: 'donut-status', title: t('appointments.insights.c_status', { defaultValue: 'Bookings by status' }), chart: 'donut', dimension: 'status', agg: 'count', color: 4 },
    { ...base, id: 'bar-weekday', title: t('appointments.insights.c_weekday', { defaultValue: 'Busiest weekdays' }), chart: 'bar', dimension: 'weekday', agg: 'count', color: 5 },
  ];
  return { datasets: [dataset], builtins };
}
