import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { CalendarDays, Globe, ListChecks, Plus, Settings2, Users } from 'lucide-react';
import { Breadcrumb, Button, DismissibleInfo, ModuleGuideButton } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { useTabKeyboardNav } from '@/shared/hooks/useTabKeyboardNav';
import { useToastStore } from '@/stores/useToastStore';
import { getErrorMessage } from '@/shared/lib/api';
import { InsightsPanel, InsightsToggleButton, useModuleInsights } from '@/features/insights';
import { appointmentsGuide } from './appointmentsGuide';
import { buildAppointmentsInsights } from './appointmentsInsights';
import { addDays, appointmentsApi, dayKey, startOfWeek, toLocalIso, type Booking } from './api';
import { AppointmentsKpis } from './components/AppointmentsKpis';
import { BookingDrawer, type DrawerDraft } from './components/BookingDrawer';
import { BookingList, type ListFilter, type ListRange } from './components/BookingList';
import { CalendarToolbar, StatusLegend } from './components/CalendarToolbar';
import { CalendarView } from './components/CalendarView';
import { OnlineBookingPanel } from './components/OnlineBookingPanel';
import { ResourcesPanel } from './components/ResourcesPanel';
import { ServicesPanel } from './components/ServicesPanel';

const TABS = ['calendar', 'list', 'services', 'resources', 'online'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  calendar: 'Calendar',
  list: 'List',
  services: 'Services',
  resources: 'Resources & hours',
  online: 'Online booking & reminders',
};
const TAB_ICON: Record<Tab, React.ElementType> = {
  calendar: CalendarDays, list: ListChecks, services: Settings2, resources: Users, online: Globe,
};
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function AppointmentsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'calendar') as Tab;
  const onTabKeyDown = useTabKeyboardNav<Tab>({ ids: TABS, activeId: tab, onChange: (k) => setParams({ tab: k }), orientation: 'horizontal' });
  const [view, setView] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(() => new Date());
  const [weekResource, setWeekResource] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [listFilter, setListFilter] = useState<ListFilter>('');
  const [listRange, setListRange] = useState<ListRange>('upcoming');
  const [draft, setDraft] = useState<DrawerDraft | null>(null);

  const services = useQuery({ queryKey: ['appointments', 'services'], queryFn: appointmentsApi.services, retry: false });
  const resources = useQuery({ queryKey: ['appointments', 'resources'], queryFn: appointmentsApi.resources, retry: false });
  const settings = useQuery({ queryKey: ['appointments', 'settings'], queryFn: appointmentsApi.settings, retry: false });
  const activeResources = useMemo(() => (resources.data ?? []).filter((r) => r.active).sort((a, b) => a.sort_order - b.sort_order), [resources.data]);

  const weekStart = startOfWeek(date);
  const [calStart, calEnd] = view === 'day' ? [midnight(date), addDays(midnight(date), 1)] : [weekStart, addDays(weekStart, 7)];
  const calendar = useQuery({
    queryKey: ['appointments', 'bookings', 'calendar', toLocalIso(calStart), toLocalIso(calEnd)],
    queryFn: () => appointmentsApi.bookings({ start: toLocalIso(calStart), end: toLocalIso(calEnd) }),
    enabled: tab === 'calendar',
    retry: false,
  });
  // One ±60-day window feeds KPIs, insights and the list.
  const today = dayKey(new Date());
  const overview = useQuery({
    queryKey: ['appointments', 'bookings', 'overview', today],
    queryFn: () => appointmentsApi.bookings({ start: `${dayKey(addDays(new Date(), -60))}T00:00:00`, end: `${dayKey(addDays(new Date(), 61))}T00:00:00` }),
    retry: false,
  });
  const overviewRows = overview.data ?? [];
  const listRows = useMemo(
    () => overviewRows.filter((b) => (listRange === 'upcoming' ? b.start_at.slice(0, 10) >= today : b.start_at.slice(0, 10) < today)),
    [overviewRows, listRange, today],
  );

  const insights = useModuleInsights('appointments', { defaultOpen: false });
  const { datasets, builtins } = useMemo(
    () => buildAppointmentsInsights(overviewRows, services.data ?? [], resources.data ?? [], t),
    [overviewRows, services.data, resources.data, t],
  );

  const move = useMutation({
    mutationFn: ({ b, resourceId, start }: { b: Booking; resourceId: string; start: Date }) =>
      appointmentsApi.updateBooking(b.id, { resource_id: resourceId, start_at: toLocalIso(start) }),
    onMutate: async ({ b, resourceId, start }) => {
      const key = ['appointments', 'bookings', 'calendar', toLocalIso(calStart), toLocalIso(calEnd)];
      const prev = qc.getQueryData<Booking[]>(key);
      const dur = new Date(b.end_at).getTime() - new Date(b.start_at).getTime();
      qc.setQueryData<Booking[]>(key, (rows) =>
        rows?.map((x) => (x.id === b.id ? { ...x, resource_id: resourceId, start_at: toLocalIso(start), end_at: toLocalIso(new Date(start.getTime() + dur)) } : x)),
      );
      return { key, prev };
    },
    onSuccess: () => addToast({ type: 'success', title: t('appointments.moved', { defaultValue: 'Booking moved' }) }),
    onError: (e, _v, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.prev);
      addToast({ type: 'error', title: t('appointments.move_failed', { defaultValue: 'Could not move the booking' }), message: getErrorMessage(e) });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['appointments', 'bookings'] }),
  });

  const noServices = (services.data ?? []).filter((s) => s.active).length === 0;
  const newBooking = () => setDraft({ start: new Date(new Date().setMinutes(0, 0, 0) + 3600_000) });
  const showList = (f: ListFilter, r: ListRange) => {
    setListFilter(f);
    setListRange(r);
    setParams({ tab: 'list' });
  };
  const calendarRows = (calendar.data ?? []).filter((b) => showCancelled || b.status !== 'cancelled');

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: t('appointments.title', { defaultValue: 'Appointments' }) }]} />
      <PageHeader
        srTitle={t('appointments.title', { defaultValue: 'Appointments' })}
        subtitle={t('appointments.subtitle', { defaultValue: 'Plan bookings for your services, staff and rooms, and let customers book online.' })}
        actions={
          <>
            <InsightsToggleButton open={insights.open} onClick={insights.toggle} />
            <ModuleGuideButton content={appointmentsGuide} onCta={newBooking} />
            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={newBooking} disabled={noServices}>
              {t('appointments.new_booking', { defaultValue: 'New booking' })}
            </Button>
          </>
        }
      />

      <InsightsPanel
        open={insights.open}
        title={t('appointments.insights.title', { defaultValue: 'Booking insights' })}
        datasets={datasets}
        builtins={builtins}
        custom={insights.custom}
        onAdd={insights.addCustom}
        onUpdate={insights.updateCustom}
        onRemove={insights.removeCustom}
        onCollapse={() => insights.setOpen(false)}
      />

      <DismissibleInfo
        storageKey="appointments"
        title={t('appointments.intro_title', { defaultValue: 'Keep your calendar full' })}
        links={[
          { label: t('appointments.intro_link_contacts', { defaultValue: 'Contacts' }), onClick: () => navigate('/contacts') },
          { label: t('appointments.intro_link_sales', { defaultValue: 'Sales' }), onClick: () => navigate('/sales') },
          { label: t('appointments.intro_link_crm', { defaultValue: 'CRM' }), onClick: () => navigate('/crm') },
        ]}
      >
        {t('appointments.intro_body', {
          defaultValue:
            'Add your services and the staff, rooms or chairs that deliver them, then book on the calendar or share your online booking link. Completed bookings can be invoiced in one click.',
        })}
      </DismissibleInfo>

      {(tab === 'calendar' || tab === 'list') && overview.isSuccess && (
        <AppointmentsKpis
          bookings={overviewRows}
          services={services.data ?? []}
          onShowRequested={() => showList('requested', 'upcoming')}
          onShowToInvoice={() => showList('to_invoice', 'past')}
        />
      )}

      <div className="border-b border-border-light">
        <nav className="-mb-px flex gap-1 overflow-x-auto" role="tablist" aria-label={t('appointments.tabs_aria', { defaultValue: 'Appointments sections' })} onKeyDown={onTabKeyDown}>
          {TABS.map((k) => {
            const Icon = TAB_ICON[k];
            const active = tab === k;
            return (
              <button
                key={k}
                role="tab"
                id={`appointments-tab-${k}`}
                aria-selected={active}
                aria-controls={`appointments-panel-${k}`}
                tabIndex={active ? 0 : -1}
                type="button"
                onClick={() => setParams({ tab: k })}
                className={clsx(
                  'flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  active ? 'border-oe-blue text-oe-blue' : 'border-transparent text-content-secondary hover:text-content-primary',
                )}
              >
                <Icon size={14} />
                {t(`appointments.tab_${k}`, { defaultValue: TAB_LABEL[k] })}
              </button>
            );
          })}
        </nav>
      </div>

      <div role="tabpanel" id={`appointments-panel-${tab}`} aria-labelledby={`appointments-tab-${tab}`} className="space-y-4">
        {(tab === 'calendar' || tab === 'list') && noServices && services.isSuccess && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-secondary p-3 text-sm">
            {t('appointments.setup_hint', { defaultValue: 'Start by adding your services and the staff, rooms or chairs that deliver them.' })}
            <Button size="sm" variant="secondary" onClick={() => setParams({ tab: 'services' })}>{t('appointments.add_service', { defaultValue: 'Add service' })}</Button>
          </div>
        )}

        {tab === 'calendar' && (
          <>
            <CalendarToolbar
              view={view}
              date={date}
              weekStart={weekStart}
              resources={activeResources}
              resourceId={weekResource}
              showCancelled={showCancelled}
              onView={setView}
              onDate={setDate}
              onResource={setWeekResource}
              onShowCancelled={setShowCancelled}
            />
            <CalendarView
              view={view}
              date={date}
              weekStart={weekStart}
              resources={activeResources}
              resourceId={weekResource}
              services={services.data ?? []}
              bookings={calendarRows}
              onCreate={(rid, start) => !noServices && setDraft({ resourceId: rid, start })}
              onOpen={(b) => setDraft({ booking: b })}
              onMove={(b, rid, start) => move.mutate({ b, resourceId: rid, start })}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-content-tertiary">
                {t('appointments.calendar_hint', { defaultValue: 'Click an empty time to book, drag a booking to move it to another time or resource.' })}
              </p>
              <StatusLegend />
            </div>
          </>
        )}

        {tab === 'list' && (
          <BookingList
            bookings={listRows}
            services={services.data ?? []}
            resources={resources.data ?? []}
            loading={overview.isLoading}
            error={overview.isError}
            filter={listFilter}
            range={listRange}
            onFilter={setListFilter}
            onRange={setListRange}
            onRetry={() => void overview.refetch()}
            onOpen={(b) => setDraft({ booking: b })}
          />
        )}

        {tab === 'services' && <ServicesPanel services={services.data ?? []} resources={resources.data ?? []} />}
        {tab === 'resources' && <ResourcesPanel resources={resources.data ?? []} />}
        {tab === 'online' && settings.data && <OnlineBookingPanel settings={settings.data} />}
      </div>

      {draft && (
        <BookingDrawer
          key={draft.booking?.id ?? `${draft.resourceId}-${draft.start?.getTime()}`}
          draft={draft}
          services={services.data ?? []}
          resources={resources.data ?? []}
          onClose={() => setDraft(null)}
        />
      )}
    </div>
  );
}
