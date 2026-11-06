// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Home for companies on a business preset (trade, services, retail, ...).
 * Construction presets keep DashboardPage. Every card owns its query and an
 * error boundary, so one failing endpoint never blanks the page.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  AlertTriangle, BarChart3, CalendarClock, Check, ChevronDown, ChevronRight, FileText, Landmark,
  LayoutGrid, Package, Plus, Receipt, RotateCcw, Truck, Upload, Wallet, X,
} from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { normalizeRole } from '@/shared/lib/roles';
import { SetupChecklist } from '@/features/onboarding/BusinessSetup';
import { useModuleStore } from '@/stores/useModuleStore';
import { apiGet, type Page } from '@/shared/lib/api';
import { Button, DateDisplay, EmptyState, ModuleGuideButton, MoneyDisplay, PAGE_CONTAINER_CLS } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { businessHomeGuide } from './businessHomeGuide';
import { salesApi, type SalesDocSummary } from '@/features/sales/api';
import { purchasingApi, type PurchasingDocSummary } from '@/features/purchasing/api';
import { mailtoDraft, receivablesApi } from '@/features/receivables/api';
import { bankingApi } from '@/features/banking/api';
import { glApi } from '@/features/accounting/api';
import { appointmentsApi } from '@/features/appointments/api';
import { itemsApi } from '@/features/items/api';
import { fetchMyTasks, type Task } from '@/features/tasks/api';
import { useBusinessDemoCases } from '@/features/business-demo/api';
import { useCompanyPresetKey } from '@/app/layout/useCompanyWorkspace';
import { termFor } from '@/app/layout/terminology';
import {
  CardError, CardLink, HomeCard, KpiTile, Lines, Segmented, Skeleton, Sparkline, Delta, TONE_PILL, type Tone,
} from './business/HomeParts';
import { AgingBar, CashForecastChart, RevenueExpenseChart, type MonthPoint } from './business/HomeCharts';
import {
  addDays, daysBetween, forecastSeries, initials, isoDay, makeMoney, num, openAmount, pctChange, useHomeLayout, type Flow,
} from './business/homeUtils';
import { fmtFixed, fmtList } from '@/shared/lib/formatters';

export { BUSINESS_PRESET_KEYS } from '@/app/layout/useCompanyWorkspace';

interface BusinessSettings { industry?: string | null; company_name?: string | null; base_currency?: string | null }

const APPOINTMENT_PRESETS = new Set(['medical_practice', 'therapy_wellness', 'beauty_salon', 'fitness_studio', 'education_training']);
const STOCK_PRESETS = new Set(['retail_ecommerce', 'franchise_multisite', 'food_production', 'manufacturing']);
const ORDER_PRESETS = new Set(['trade_distribution', 'logistics', 'craft_trades', 'field_service']);
const CHECKLIST_DISMISS_KEY = 'oe.bizHome.checklistDismissed';
const CLOSED_SALES = new Set(['paid', 'cancelled', 'rejected', 'converted', 'invoiced', 'expired', 'draft']);
const CLOSED_BILLS = new Set(['paid', 'cancelled', 'draft', 'applied', 'closed']);
const OPEN_PO = new Set(['confirmed', 'sent', 'partially_received', 'approved', 'ordered']);
const MAIN_CARDS = ['revenue', 'forecast', 'attention', 'aging', 'industry'];
const RAIL_CARDS = ['today', 'activity', 'leaders'];

type IndustryWidget = 'stock' | 'orders' | 'utilization' | 'pipeline';

function widgetFor(preset: string | null, appointments: boolean): IndustryWidget {
  if (preset && STOCK_PRESETS.has(preset)) return 'stock';
  if (preset && ORDER_PRESETS.has(preset)) return 'orders';
  if (appointments) return 'utilization';
  return 'pipeline';
}

interface InboxItem { id: string; title: string; sub?: string; amount?: number; age?: string; action?: ReactNode }
interface InboxGroup {
  key: string; icon: typeof Receipt; tone: Tone; rank: number; label: string; count: number; total: number;
  to: string; q: UseQueryResult<unknown>; items: InboxItem[];
}

/* ── page ────────────────────────────────────────────────────────────────── */

export function BusinessHome() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const preset = useCompanyPresetKey();
  const isModuleEnabled = useModuleStore((s) => s.isModuleEnabled);
  const isAdmin = normalizeRole(useAuthStore((s) => s.userRole)) === 'admin';
  const firstName = (useAuthStore((s) => s.userFullName) ?? '').trim().split(/\s+/)[0] ?? '';

  const now = new Date();
  const today = isoDay(now);
  const weekEnd = isoDay(addDays(now, 7));
  const prevMonthEnd = isoDay(new Date(now.getFullYear(), now.getMonth(), 0));
  const q = { retry: false, staleTime: 60_000 } as const;

  const showAppointments = (!!preset && APPOINTMENT_PRESETS.has(preset)) || isModuleEnabled('appointments');
  const widget = widgetFor(preset, showAppointments);

  const settings = useQuery({ ...q, queryKey: ['business-settings'], queryFn: () => apiGet<BusinessSettings>('/v1/business-settings/') });
  const summary = useQuery({ ...q, queryKey: ['home-biz', 'sales-summary', 12], queryFn: () => salesApi.summary(12) });
  const purch = useQuery({ ...q, queryKey: ['home-biz', 'purchasing-summary'], queryFn: () => purchasingApi.summary() });
  const aging = useQuery({ ...q, queryKey: ['home-biz', 'aging'], queryFn: () => receivablesApi.aging() });
  const bills = useQuery({ ...q, queryKey: ['home-biz', 'bills'], queryFn: () => purchasingApi.list('bills') });
  const invoices = useQuery({ ...q, queryKey: ['home-biz', 'invoices'], queryFn: () => salesApi.list('invoices') });
  const quotes = useQuery({ ...q, queryKey: ['home-biz', 'quotes'], queryFn: () => salesApi.list('quotes') });
  const bankAccounts = useQuery({ ...q, queryKey: ['home-biz', 'bank-accounts'], queryFn: () => bankingApi.accounts() });
  const unmatched = useQuery({ ...q, queryKey: ['home-biz', 'bank-unmatched'], queryFn: () => bankingApi.transactions(undefined, 'unmatched') });
  const hasBank = (bankAccounts.data ?? []).length > 0;
  const bsNow = useQuery({ ...q, queryKey: ['home-biz', 'bs', today], queryFn: () => glApi.balanceSheet(today), enabled: hasBank });
  const bsPrev = useQuery({ ...q, queryKey: ['home-biz', 'bs', prevMonthEnd], queryFn: () => glApi.balanceSheet(prevMonthEnd), enabled: hasBank });
  const tasks = useQuery({ ...q, queryKey: ['home-biz', 'my-tasks'], queryFn: () => fetchMyTasks() });
  const contacts = useQuery({ ...q, queryKey: ['home-biz', 'contacts-count'], queryFn: () => apiGet<Page<unknown>>('/v1/contacts/?limit=1') });
  const bookings = useQuery({
    ...q, queryKey: ['home-biz', 'bookings', today], enabled: showAppointments,
    queryFn: () => appointmentsApi.bookings({ start: `${today}T00:00:00`, end: `${today}T23:59:59` }),
  });
  const lowStock = useQuery({ ...q, queryKey: ['home-biz', 'low-stock'], enabled: widget === 'stock', queryFn: () => itemsApi.list({ alert: 'below_min', limit: 5 }) });
  const orders = useQuery({ ...q, queryKey: ['home-biz', 'orders'], enabled: widget === 'orders', queryFn: () => purchasingApi.list('orders') });
  const salesStats = useQuery({ ...q, queryKey: ['home-biz', 'sales-stats'], enabled: widget === 'pipeline', queryFn: () => salesApi.stats() });
  const demoCases = useBusinessDemoCases();

  const refresh = () => void qc.invalidateQueries({ queryKey: ['home-biz'] });
  const reminder = useMutation({
    mutationFn: (id: string) => salesApi.bulk('invoices', 'reminder_drafts', [id]),
    onSuccess: (res) => {
      const d = res.drafts[0];
      if (d) window.location.href = mailtoDraft(d, d.to);
      else navigate('/receivables?bucket=overdue');
    },
  });
  const approveBill = useMutation({ mutationFn: (id: string) => purchasingApi.post('bills', id), onSuccess: refresh });

  const sm = summary.data;
  const currency = sm?.currency ?? purch.data?.currency ?? settings.data?.base_currency ?? 'EUR';
  const money = makeMoney(currency, locale);
  const M = (v: number, compact = false) => <MoneyDisplay amount={v} currency={currency} compact={compact} />;
  const companyName = settings.data?.company_name?.trim() || '';
  const customersTerm = termFor(preset, '/contacts');
  const customers = customersTerm
    ? t(customersTerm.key, { defaultValue: customersTerm.defaultLabel })
    : t('home.biz_customers', { defaultValue: 'Customers' });

  const hour = now.getHours();
  const greeting = hour < 12
    ? t('home.biz_greeting_morning', { defaultValue: 'Good morning' })
    : hour < 18
      ? t('home.biz_greeting_afternoon', { defaultValue: 'Good afternoon' })
      : t('home.biz_greeting_evening', { defaultValue: 'Good evening' });
  const dateLabel = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  /* revenue & expenses by month */
  const revMonths = sm?.revenue_by_month ?? [];
  const expenseByMonth = new Map<string, number>();
  for (const b of bills.data ?? []) {
    if (b.status === 'draft' || b.status === 'cancelled') continue;
    const m = b.doc_date?.slice(0, 7);
    if (m) expenseByMonth.set(m, (expenseByMonth.get(m) ?? 0) + num(b.net_total || b.gross_total) * (b.kind === 'credit_note' ? -1 : 1));
  }
  const curMonth = today.slice(0, 7);
  const months: MonthPoint[] = revMonths.map((m) => {
    const revenue = num(m.revenue), expenses = expenseByMonth.get(m.month) ?? 0;
    return {
      month: new Date(`${m.month}-01T00:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
      label: new Date(`${m.month}-01T00:00:00`).toLocaleDateString(locale, { month: 'short' }),
      revenue, expenses, net: revenue - expenses, current: m.month === curMonth,
    };
  });
  const [period, setPeriod] = useState<3 | 6 | 12>(6);
  const chartData = months.slice(-period);
  const chartHasData = chartData.some((d) => d.revenue !== 0 || d.expenses !== 0);
  const cur = months[months.length - 1], prev = months[months.length - 2];
  const revNow = sm ? num(sm.revenue_this_month) : 0;
  const revPrev = prev?.revenue ?? 0;
  const netNow = cur?.net ?? 0, netPrev = prev?.net ?? 0;

  /* cash */
  const glCodes = new Set((bankAccounts.data ?? []).map((a) => a.gl_account_code).filter(Boolean));
  const cashOf = (bs: typeof bsNow.data) =>
    (bs?.asset.accounts ?? []).filter((a) => glCodes.has(a.code)).reduce((s, a) => s + num(a.balance), 0);
  const cashNow = bsNow.data ? cashOf(bsNow.data) : null;
  const cashPrev = bsPrev.data ? cashOf(bsPrev.data) : null;

  const openInvoices = (invoices.data ?? []).filter((d) => !CLOSED_SALES.has(d.status) && openAmount(d) > 0);
  const openBills = (bills.data ?? []).filter((b) => b.kind !== 'credit_note' && !CLOSED_BILLS.has(b.status) && openAmount(b) > 0);
  const flows: Flow[] = [
    ...openInvoices.map((d) => ({ date: (d.due_date ?? d.doc_date ?? today).slice(0, 10), amount: openAmount(d) })),
    ...openBills.map((b) => ({ date: (b.due_date ?? b.doc_date ?? today).slice(0, 10), amount: -openAmount(b) })),
  ];
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30);
  const forecast = forecastSeries(cashNow ?? 0, flows, today, horizon);
  const next30 = forecastSeries(0, flows, today, 30);
  const net30 = next30[next30.length - 1]!.balance;
  const in30 = next30.reduce((s, p) => s + p.inflow, 0), out30 = next30.reduce((s, p) => s + p.outflow, 0);
  const lowPoint = forecast.reduce((lo, p) => (p.balance < lo.balance ? p : lo), forecast[0]!);
  const flowsLoading = invoices.isLoading || bills.isLoading;

  const billsDueWeek = openBills.filter((b) => b.due_date && b.due_date.slice(0, 10) <= weekEnd);
  const billsDueWeekValue = billsDueWeek.reduce((s, b) => s + openAmount(b), 0);
  const payables = purch.data ? num(purch.data.payables) : sm?.payables != null ? num(sm.payables) : null;

  /* needs-attention inbox */
  const overdueInvoices = openInvoices.filter((d) => d.due_date && d.due_date.slice(0, 10) < today).sort((a, b) => openAmount(b) - openAmount(a));
  const overdueCount = sm?.overdue_count ?? overdueInvoices.length;
  const expiringQuotes = (quotes.data ?? []).filter((d) => d.status === 'sent' && d.due_date && d.due_date.slice(0, 10) >= today && d.due_date.slice(0, 10) <= weekEnd);
  const draftSales = [...(invoices.data ?? []), ...(quotes.data ?? [])].filter((d: SalesDocSummary) => d.status === 'draft');
  const draftBills = (bills.data ?? []).filter((d: PurchasingDocSummary) => d.status === 'draft');
  const unmatchedLines = unmatched.data ?? [];
  const daysOverdue = (due: string | null) => (due ? daysBetween(due, today) : 0);
  const ageLabel = (n: number) => t('home.biz_days_overdue', { defaultValue: '{{count}} d overdue', count: n });
  const dueLabel = (due: string | null) => {
    const n = due ? daysBetween(today, due) : 0;
    return n <= 0 ? t('home.biz_due_today', { defaultValue: 'Due today' }) : t('home.biz_due_in', { defaultValue: 'in {{count}} d', count: n });
  };
  const actBtn = 'rounded-md border border-border-light bg-surface-elevated px-2 py-1 text-[11px] font-medium text-content-primary hover:border-oe-blue/40 hover:text-oe-blue disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue';
  const actLink = (to: string, label: string) => <Link to={to} className={actBtn}>{label}</Link>;

  const groups: InboxGroup[] = [
    { key: 'overdue', icon: AlertTriangle, tone: 'danger', rank: 0, q: summary, to: '/receivables?bucket=overdue', count: overdueCount,
      total: overdueInvoices.reduce((s, d) => s + openAmount(d), 0),
      label: t('home.biz_att_overdue', { defaultValue: 'Overdue invoices' }),
      items: overdueInvoices.slice(0, 3).map((d) => ({
        id: d.id, title: d.customer_name || d.number, sub: d.number, amount: openAmount(d), age: ageLabel(daysOverdue(d.due_date)),
        action: (
          <button type="button" className={actBtn} disabled={reminder.isPending} onClick={() => reminder.mutate(d.id)}>
            {t('home.biz_act_reminder', { defaultValue: 'Draft reminder' })}
          </button>
        ),
      })) },
    { key: 'bills', icon: Receipt, tone: 'warn', rank: 1, q: bills, to: '/purchasing?tab=bills&status=posted', count: billsDueWeek.length,
      total: billsDueWeekValue, label: t('home.biz_att_bills', { defaultValue: 'Bills due within 7 days' }),
      items: [...billsDueWeek].sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '')).slice(0, 3).map((b) => ({
        id: b.id, title: b.supplier_name || b.number, sub: b.number, amount: openAmount(b),
        age: b.due_date && b.due_date.slice(0, 10) < today ? ageLabel(daysOverdue(b.due_date)) : dueLabel(b.due_date),
        action: actLink(`/purchasing/bills/${b.id}`, t('home.biz_act_pay', { defaultValue: 'Record payment' })),
      })) },
    { key: 'bank', icon: Landmark, tone: 'warn', rank: 2, q: unmatched, to: '/banking?tab=reconcile', count: unmatchedLines.length,
      total: unmatchedLines.reduce((s, x) => s + Math.abs(num(x.amount)), 0),
      label: t('home.biz_att_bank', { defaultValue: 'Unmatched bank lines' }),
      items: unmatchedLines.slice(0, 3).filter((x) => x.amount != null).map((x) => ({
        id: x.id, title: x.counterparty_name || x.reference || '—', sub: x.booking_date, amount: num(x.amount),
        age: x.booking_date ? t('home.biz_days_ago', { defaultValue: '{{count}} d ago', count: Math.max(0, daysBetween(x.booking_date, today)) }) : undefined,
        action: actLink(`/banking?tab=reconcile${x.account_id ? `&account=${x.account_id}` : ''}`, t('home.biz_act_match', { defaultValue: 'Match' })),
      })) },
    { key: 'quotes', icon: CalendarClock, tone: 'neutral', rank: 3, q: quotes, to: '/sales?tab=quotes&status=sent', count: expiringQuotes.length,
      total: expiringQuotes.reduce((s, d) => s + num(d.gross_total), 0),
      label: t('home.biz_att_quotes', { defaultValue: 'Quotes expiring this week' }),
      items: expiringQuotes.slice(0, 3).map((d) => ({
        id: d.id, title: d.customer_name || d.number || '—', sub: d.number, amount: num(d.gross_total), age: dueLabel(d.due_date),
        action: actLink(`/sales/quotes/${d.id}`, t('home.biz_act_follow_up', { defaultValue: 'Follow up' })),
      })) },
    { key: 'drafts', icon: FileText, tone: 'neutral', rank: 4, q: invoices, to: '/sales?tab=invoices&status=draft', count: draftSales.length + draftBills.length,
      total: 0, label: t('home.biz_att_drafts', { defaultValue: 'Draft documents' }),
      items: [
        ...draftBills.slice(0, 3).map((b) => ({
          id: b.id, title: b.supplier_name || b.number || '—', sub: t('home.biz_bill', { defaultValue: 'Supplier bill' }), amount: num(b.gross_total),
          action: (
            <button type="button" className={actBtn} disabled={approveBill.isPending} onClick={() => approveBill.mutate(b.id)}>
              {t('home.biz_act_approve', { defaultValue: 'Approve' })}
            </button>
          ),
        })),
        ...draftSales.filter((d) => d.number || d.customer_name).slice(0, 2).map((d) => ({
          id: d.id, title: d.customer_name || d.number, sub: d.number, amount: num(d.gross_total),
          action: actLink(`/sales/${d.kind === 'quote' ? 'quotes' : 'invoices'}/${d.id}`, t('home.biz_act_finish', { defaultValue: 'Finish' })),
        })),
      ].slice(0, 3) },
  ];
  const inboxLoading = groups.some((g) => g.q.isLoading);
  const inbox = groups.filter((g) => g.count > 0 && !g.q.isError).sort((a, b) => a.rank - b.rank || b.total - a.total);
  const inboxFailed = groups.filter((g) => g.q.isError);
  const inboxTotal = inbox.reduce((s, g) => s + g.count, 0);

  /* today */
  const openTasks = (tasks.data?.items ?? []).filter((x) => x.status !== 'completed');
  const dueTasks = openTasks
    .filter((x) => x.is_overdue || (x.due_date && x.due_date.slice(0, 10) <= today))
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  const upcoming = openTasks
    .filter((x) => !dueTasks.includes(x))
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    .slice(0, 3);
  const todayBookings = (bookings.data ?? []).filter((b) => b.status !== 'cancelled').sort((a, b) => a.start_at.localeCompare(b.start_at));
  const bookedHours = todayBookings.reduce((s, b) => s + Math.max(0, (Date.parse(b.end_at) - Date.parse(b.start_at)) / 3_600_000), 0);

  /* activity: the newest documents across sales and purchasing */
  const activity = [
    ...(invoices.data ?? []).map((d) => ({ id: d.id, kind: 'invoice' as const, who: d.customer_name, number: d.number, date: d.doc_date, amount: num(d.gross_total), status: d.status, to: `/sales/invoices/${d.id}` })),
    ...(quotes.data ?? []).map((d) => ({ id: d.id, kind: 'quote' as const, who: d.customer_name, number: d.number, date: d.doc_date, amount: num(d.gross_total), status: d.status, to: `/sales/quotes/${d.id}` })),
    ...(bills.data ?? []).map((d) => ({ id: d.id, kind: 'bill' as const, who: d.supplier_name, number: d.number, date: d.doc_date, amount: num(d.gross_total), status: d.status, to: `/purchasing/bills/${d.id}` })),
  ].filter((a) => a.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const kindLabel = {
    invoice: t('home.biz_kind_invoice', { defaultValue: 'Invoice' }),
    quote: t('home.biz_kind_quote', { defaultValue: 'Quote' }),
    bill: t('home.biz_kind_bill', { defaultValue: 'Bill' }),
  };

  /* leaders of the month */
  const [leaderTab, setLeaderTab] = useState<'customers' | 'items'>('customers');
  const topCustomers = sm?.top_customers ?? [];
  const topItems = sm?.top_items ?? [];

  /* checklist */
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(CHECKLIST_DISMISS_KEY) === '1'; } catch { return false; }
  });
  const hasInvoice = (invoices.data ?? []).length > 0 || num(sm?.receivables) !== 0 || num(sm?.revenue_this_month) !== 0;
  const checklist = [
    { key: 'company', to: '/settings?tab=company', done: !!companyName, label: t('home.biz_check_company', { defaultValue: 'Add company details' }) },
    { key: 'customers', to: '/import?target=customers', done: (contacts.data?.total ?? 0) > 0,
      label: t('home.biz_check_customers_term', { defaultValue: 'Import {{who}}', who: customers }) },
    { key: 'invoice', to: '/sales/invoices/new', done: hasInvoice, label: t('home.biz_check_invoice', { defaultValue: 'Create your first invoice' }) },
    { key: 'bank', to: '/banking', done: hasBank, label: t('home.biz_check_bank_statement', { defaultValue: 'Connect a bank statement' }) },
    { key: 'team', to: '/users', done: false, label: t('home.biz_check_team', { defaultValue: 'Invite your team' }) },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const checklistLoading = settings.isLoading || contacts.isLoading || invoices.isLoading || bankAccounts.isLoading;
  // "Invite team" has no reliable signal, so four of five counts as complete.
  const showChecklist = !dismissed && !checklistLoading && doneCount < checklist.length - 1;
  const dismissChecklist = () => {
    setDismissed(true);
    try { localStorage.setItem(CHECKLIST_DISMISS_KEY, '1'); } catch { /* private mode */ }
  };

  const noData = !summary.isLoading && !hasInvoice && !(quotes.data ?? []).length;
  const sampleCase = noData
    ? (demoCases.data ?? []).find((c) => !c.installed && (!settings.data?.industry || c.key === settings.data.industry))
    : undefined;

  /* layout */
  const layout = useHomeLayout([...MAIN_CARDS, ...RAIL_CARDS]);
  const [editing, setEditing] = useState(false);

  const moreActions = [
    { to: '/import', label: t('home.biz_action_import', { defaultValue: 'Import data' }), icon: Upload },
    { to: '/contacts', label: t('home.biz_action_contact', { defaultValue: 'Add to {{who}}', who: customers }), icon: Package },
    { to: '/banking', label: t('home.biz_action_statement', { defaultValue: 'Upload bank statement' }), icon: Landmark },
    ...(showAppointments ? [{ to: '/appointments', label: t('home.biz_action_appointment', { defaultValue: 'Book appointment' }), icon: CalendarClock }] : []),
  ];

  /* ── cards ── */
  const cards: Record<string, { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; body: ReactNode; testId: string }> = {
    revenue: {
      testId: 'biz-chart',
      title: t('home.biz_chart_title', { defaultValue: 'Revenue vs expenses' }),
      subtitle: t('home.biz_chart_sub', { defaultValue: 'Invoiced revenue, supplier bills and the net result per month' }),
      action: (
        <Segmented label={t('home.biz_period', { defaultValue: 'Period' })} value={period} onChange={setPeriod}
          options={[3, 6, 12].map((m) => ({ value: m as 3 | 6 | 12, label: t('home.biz_months_short', { defaultValue: '{{count}}m', count: m }) }))} />
      ),
      body: summary.isLoading ? <Skeleton className="h-64" />
        : summary.isError ? <CardError onRetry={() => void summary.refetch()} />
          : !chartHasData ? (
            <EmptyState icon={<BarChart3 size={22} />}
              title={t('home.biz_chart_empty_title', { defaultValue: 'No figures yet' })}
              description={t('home.biz_chart_empty', { defaultValue: 'Your monthly revenue and expenses will appear here once you issue invoices and record bills.' })}
              action={<Button variant="secondary" size="sm" onClick={() => navigate('/sales/invoices/new')}>{t('home.biz_action_invoice', { defaultValue: 'New invoice' })}</Button>} />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-content-secondary">
                {[['var(--oe-blue)', t('home.biz_revenue', { defaultValue: 'Revenue' })], ['var(--oe-warning)', t('home.biz_expenses', { defaultValue: 'Expenses (bills)' })], ['var(--oe-success)', t('home.biz_net', { defaultValue: 'Net' })]].map(([c, l]) => (
                  <span key={l} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>
                ))}
              </div>
              <RevenueExpenseChart data={chartData} fmt={money} />
            </>
          ),
    },
    forecast: {
      testId: 'biz-forecast',
      title: t('home.biz_forecast_title', { defaultValue: 'Cash outlook' }),
      subtitle: t('home.biz_forecast_sub', { defaultValue: 'Bank balance plus open invoices minus open bills, by due date' }),
      action: (
        <Segmented label={t('home.biz_horizon', { defaultValue: 'Horizon' })} value={horizon} onChange={setHorizon}
          options={[30, 60, 90].map((d) => ({ value: d as 30 | 60 | 90, label: t('home.biz_days_short', { defaultValue: '{{count}}d', count: d }) }))} />
      ),
      body: flowsLoading ? <Skeleton className="h-48" />
        : invoices.isError && bills.isError ? <CardError onRetry={refresh} />
          : flows.length === 0 && cashNow === null ? (
            <EmptyState icon={<Wallet size={22} />}
              title={t('home.biz_forecast_empty_title', { defaultValue: 'Nothing due yet' })}
              description={t('home.biz_forecast_empty', { defaultValue: 'Issue invoices with due dates and record bills to see how cash will move.' })}
              action={<Button variant="secondary" size="sm" onClick={() => navigate('/banking')}>{t('home.biz_connect_bank', { defaultValue: 'Connect bank' })}</Button>} />
          ) : (
            <>
              <dl className="mb-3 grid grid-cols-3 gap-3 text-xs">
                <div><dt className="text-content-tertiary">{t('home.biz_cash_in', { defaultValue: 'Money in' })}</dt><dd className="mt-0.5 font-semibold tabular-nums text-semantic-success">{M(forecast.reduce((s, p) => s + p.inflow, 0), true)}</dd></div>
                <div><dt className="text-content-tertiary">{t('home.biz_cash_out', { defaultValue: 'Money out' })}</dt><dd className="mt-0.5 font-semibold tabular-nums text-semantic-warning">{M(forecast.reduce((s, p) => s + p.outflow, 0), true)}</dd></div>
                <div><dt className="text-content-tertiary">{t('home.biz_low_point', { defaultValue: 'Lowest balance' })}</dt>
                  <dd className={`mt-0.5 font-semibold tabular-nums ${lowPoint.balance < 0 ? 'text-semantic-error' : 'text-content-primary'}`}>{M(lowPoint.balance, true)} <span className="font-normal text-content-tertiary"><DateDisplay value={lowPoint.date} /></span></dd></div>
              </dl>
              <CashForecastChart data={forecast} fmt={money} locale={locale} />
            </>
          ),
    },
    attention: {
      testId: 'biz-attention',
      title: t('home.biz_attention', { defaultValue: 'Needs attention' }),
      subtitle: inboxTotal ? t('home.biz_attention_sub', { defaultValue: '{{count}} items, most urgent first', count: inboxTotal }) : undefined,
      body: inboxLoading ? <Lines n={4} /> : (
        <>
          {inbox.length === 0 ? (
            <EmptyState icon={<Check size={22} />}
              title={t('home.biz_attention_empty_title', { defaultValue: 'All clear' })}
              description={t('home.biz_attention_empty', { defaultValue: 'All clear — nothing is waiting on you.' })} />
          ) : (
            <ul className="-mx-2 divide-y divide-border-light">
              {inbox.map((g) => (
                <li key={g.key} className="py-1.5">
                  <Link to={g.to} data-testid={`biz-att-${g.key}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TONE_PILL[g.tone]}`}><g.icon className="h-4 w-4" aria-hidden /></span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-content-primary">{g.label}</span>
                    {g.total > 0 && <span className="hidden text-xs tabular-nums text-content-secondary sm:inline">{M(g.total)}</span>}
                    <span className={`min-w-[2rem] rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums ${TONE_PILL[g.tone]}`} data-testid="biz-att-count">{g.count}</span>
                    <ChevronRight className="h-4 w-4 text-content-tertiary" aria-hidden />
                  </Link>
                  {g.items.length > 0 && (
                    <ul className="ml-[52px] mr-2 space-y-0.5 pb-1">
                      {g.items.map((it) => (
                        <li key={it.id} className="flex items-center gap-3 py-1 text-xs">
                          <span className="min-w-0 flex-1 truncate">
                            <span className="text-content-primary">{it.title}</span>
                            {it.sub && it.sub !== it.title && <span className="text-content-tertiary"> · {it.sub}</span>}
                          </span>
                          {it.age && <span className={`hidden shrink-0 sm:inline ${g.tone === 'danger' ? 'text-semantic-error' : 'text-content-tertiary'}`}>{it.age}</span>}
                          {it.amount != null && <span className="shrink-0 tabular-nums text-content-secondary">{M(it.amount)}</span>}
                          {it.action && <span className="shrink-0">{it.action}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {(reminder.isError || approveBill.isError) && (
            <p className="mt-2 text-xs text-semantic-error" role="alert">{t('home.biz_action_failed', { defaultValue: 'That action did not go through. Open the document to finish it.' })}</p>
          )}
          {inboxFailed.length > 0 && (
            <p className="mt-2 text-xs text-content-tertiary">
              {t('home.biz_attention_partial', { defaultValue: 'Some checks could not load: {{list}}', list: fmtList(inboxFailed.map((g) => g.label)) })}
            </p>
          )}
        </>
      ),
    },
    aging: {
      testId: 'biz-aging',
      title: t('home.biz_aging_title', { defaultValue: 'Receivables by age' }),
      subtitle: t('home.biz_aging_sub', { defaultValue: 'Click a band to see who owes it' }),
      action: <CardLink to="/receivables">{t('home.biz_view_all', { defaultValue: 'View all' })}</CardLink>,
      body: aging.isLoading ? <Lines n={3} /> : aging.isError ? <CardError onRetry={() => void aging.refetch()} />
        : num(aging.data?.totals?.total) <= 0 && !(aging.data?.rows ?? []).length ? (
          <EmptyState icon={<Receipt size={22} />}
            title={t('home.biz_top_empty_title', { defaultValue: 'Nothing outstanding' })}
            description={t('home.biz_top_empty', { defaultValue: 'No open invoices — everyone has paid.' })} />
        ) : <AgingBar totals={aging.data?.totals ?? {}} currency={currency} />,
    },
    industry: industryCard(),
    today: {
      testId: 'biz-today',
      title: t('home.biz_today', { defaultValue: 'Today' }),
      subtitle: dateLabel,
      action: <CardLink to="/tasks">{t('home.biz_view_all', { defaultValue: 'View all' })}</CardLink>,
      body: tasks.isLoading ? <Lines /> : tasks.isError ? <CardError onRetry={() => void tasks.refetch()} /> : (
        <div className="space-y-4">
          {dueTasks.length > 0 ? (
            <ul className="space-y-1">
              {dueTasks.slice(0, 6).map((task: Task) => {
                const overdue = task.is_overdue || (!!task.due_date && task.due_date.slice(0, 10) < today);
                return (
                  <li key={task.id} className="flex items-center gap-2.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${overdue ? 'bg-semantic-error' : 'bg-oe-blue'}`} aria-hidden />
                    <Link to="/tasks" className="min-w-0 flex-1 truncate rounded text-sm text-content-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue">{task.title}</Link>
                    <span className={`shrink-0 text-xs ${overdue ? 'font-medium text-semantic-error' : 'text-content-tertiary'}`}>
                      {overdue ? t('home.biz_overdue', { defaultValue: 'Overdue' }) : t('home.biz_due_today', { defaultValue: 'Due today' })}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-content-secondary">{t('home.biz_today_empty', { defaultValue: 'Nothing due today.' })}</p>
          )}
          {dueTasks.length === 0 && upcoming.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-content-tertiary">{t('home.biz_up_next', { defaultValue: 'Up next' })}</p>
              <ul className="space-y-1">
                {upcoming.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm text-content-secondary">{task.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-content-tertiary">{task.due_date ? <DateDisplay value={task.due_date.slice(0, 10)} /> : '—'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {openTasks.length === 0 && <CardLink to="/tasks">{t('home.biz_add_task', { defaultValue: 'Add a task' })}</CardLink>}
          {showAppointments && (
            <div className="border-t border-border-light pt-3" data-testid="biz-appointments">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-content-tertiary">{t('home.biz_appointments_today', { defaultValue: 'Appointments today' })}</p>
              {bookings.isLoading ? <Lines n={2} /> : bookings.isError ? <CardError onRetry={() => void bookings.refetch()} />
                : todayBookings.length === 0 ? <p className="text-sm text-content-secondary">{t('home.biz_appointments_empty', { defaultValue: 'No appointments booked for today.' })}</p>
                  : (
                    <ul className="space-y-1.5">
                      {todayBookings.slice(0, 6).map((b) => (
                        <li key={b.id} className="flex items-center gap-3 text-sm">
                          <span className="w-11 shrink-0 text-xs font-medium tabular-nums text-content-secondary"><DateDisplay value={b.start_at} format="time" /></span>
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-oe-blue/10 text-[10px] font-semibold text-oe-blue" aria-hidden>{initials(b.client_name || '')}</span>
                          <span className="truncate text-content-primary">{b.client_name || '—'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
            </div>
          )}
        </div>
      ),
    },
    activity: {
      testId: 'biz-activity',
      title: t('home.biz_activity', { defaultValue: 'Recent activity' }),
      body: invoices.isLoading && bills.isLoading ? <Lines n={4} /> : activity.length === 0 ? (
        <EmptyState icon={<FileText size={22} />}
          title={t('home.biz_activity_empty_title', { defaultValue: 'No documents yet' })}
          description={t('home.biz_activity_empty', { defaultValue: 'Quotes, invoices and bills you create show up here.' })}
          action={<Button variant="secondary" size="sm" onClick={() => navigate('/sales/quotes/new')}>{t('home.biz_action_quote', { defaultValue: 'New quote' })}</Button>} />
      ) : (
        <ol className="relative space-y-3 border-l border-border-light pl-4">
          {activity.map((a) => (
            <li key={`${a.kind}-${a.id}`} className="relative">
              <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface-elevated ${a.kind === 'bill' ? 'bg-semantic-warning' : a.kind === 'quote' ? 'bg-content-tertiary' : 'bg-oe-blue'}`} aria-hidden />
              <Link to={a.to} className="block rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue">
                <span className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate text-content-primary">{kindLabel[a.kind]} {a.number}</span>
                  <span className="shrink-0 tabular-nums text-content-secondary">{M(a.amount)}</span>
                </span>
                <span className="flex justify-between gap-2 text-xs text-content-tertiary">
                  <span className="truncate">{a.who || '—'}</span><DateDisplay value={a.date} format="relative" />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ),
    },
    leaders: {
      testId: 'biz-top-customers',
      title: t('home.biz_leaders', { defaultValue: 'Top this month' }),
      action: (
        <Segmented label={t('home.biz_leaders', { defaultValue: 'Top this month' })} value={leaderTab} onChange={setLeaderTab}
          options={[{ value: 'customers', label: customers }, { value: 'items', label: t('home.biz_products', { defaultValue: 'Products' }) }]} />
      ),
      body: summary.isLoading ? <Lines n={4} /> : summary.isError ? <CardError onRetry={() => void summary.refetch()} /> : (() => {
        const rows = leaderTab === 'customers'
          ? topCustomers.map((c) => ({ key: c.customer_id ?? c.customer_name, name: c.customer_name || '—', value: num(c.revenue), meta: t('home.biz_invoice_count', { defaultValue: '{{count}} invoices', count: c.invoices }) }))
          : topItems.map((i) => ({ key: i.item_id ?? i.sku ?? i.name, name: i.name || i.sku || '—', value: num(i.revenue), meta: `× ${num(i.qty).toLocaleString(locale)}` }));
        const max = rows[0]?.value || 1;
        if (!rows.length) return (
          <EmptyState icon={<BarChart3 size={22} />}
            title={t('home.biz_leaders_empty_title', { defaultValue: 'No sales this month yet' })}
            description={t('home.biz_leaders_empty', { defaultValue: 'Your best {{who}} and products appear once this month’s invoices are issued.', who: customers.toLowerCase() })}
            action={<Button variant="secondary" size="sm" onClick={() => navigate('/sales/invoices/new')}>{t('home.biz_action_invoice', { defaultValue: 'New invoice' })}</Button>} />
        );
        return (
          <ol className="space-y-3">
            {rows.map((r, i) => (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="w-4 shrink-0 text-right text-xs tabular-nums text-content-tertiary">{i + 1}</span>
                    <span className="truncate text-content-primary">{r.name}</span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums text-content-primary">{M(r.value)}</span>
                </div>
                <div className="ml-[26px] mt-1 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-secondary"><div className="h-full rounded-full bg-oe-blue/70" style={{ width: `${(r.value / max) * 100}%` }} /></div>
                  <span className="shrink-0 text-[11px] text-content-tertiary">{r.meta}</span>
                </div>
              </li>
            ))}
          </ol>
        );
      })(),
    },
  };

  function industryCard() {
    if (widget === 'stock') {
      const items = lowStock.data?.items ?? [];
      return {
        testId: 'biz-industry',
        title: t('home.biz_low_stock', { defaultValue: 'Low stock' }),
        subtitle: t('home.biz_low_stock_sub', { defaultValue: 'Items below their minimum level — reorder before they run out' }),
        action: <CardLink to="/items?alert=below_min">{t('home.biz_view_all', { defaultValue: 'View all' })}</CardLink>,
        body: lowStock.isLoading ? <Lines n={3} /> : lowStock.isError ? <CardError onRetry={() => void lowStock.refetch()} />
          : items.length === 0 ? <EmptyState icon={<Package size={22} />} title={t('home.biz_low_stock_empty_title', { defaultValue: 'Stock looks healthy' })}
            description={t('home.biz_low_stock_empty', { defaultValue: 'No item is below its minimum level.' })} />
            : (
              <ul className="space-y-2">
                {items.map((it) => {
                  const onHand = num(lowStock.data?.on_hand?.[it.id]), min = num(it.min_stock);
                  return (
                    <li key={it.id} className="flex items-center gap-3 text-sm">
                      <Link to={`/items/${it.id}`} className="min-w-0 flex-1 truncate rounded text-content-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue">{it.name}</Link>
                      <span className="shrink-0 text-xs tabular-nums text-semantic-error">{onHand.toLocaleString(locale)} / {min.toLocaleString(locale)} {it.uom}</span>
                      {actLink(`/purchasing/orders/new${it.default_supplier_id ? `?supplier=${it.default_supplier_id}` : ''}`, t('home.biz_act_reorder', { defaultValue: 'Reorder' }))}
                    </li>
                  );
                })}
              </ul>
            ),
      };
    }
    if (widget === 'orders') {
      const open = (orders.data ?? []).filter((o) => OPEN_PO.has(o.status));
      const value = open.reduce((s, o) => s + num(o.gross_total), 0);
      return {
        testId: 'biz-industry',
        title: t('home.biz_open_pos', { defaultValue: 'Open purchase orders' }),
        subtitle: t('home.biz_open_pos_sub', { defaultValue: 'Ordered from suppliers, not yet fully received' }),
        action: <CardLink to="/purchasing?tab=orders">{t('home.biz_view_all', { defaultValue: 'View all' })}</CardLink>,
        body: orders.isLoading ? <Lines n={3} /> : orders.isError ? <CardError onRetry={() => void orders.refetch()} />
          : open.length === 0 ? <EmptyState icon={<Truck size={22} />} title={t('home.biz_open_pos_empty_title', { defaultValue: 'No open orders' })}
            description={t('home.biz_open_pos_empty', { defaultValue: 'Purchase orders waiting for delivery show up here.' })}
            action={<Button variant="secondary" size="sm" onClick={() => navigate('/purchasing/orders/new')}>{t('home.biz_action_po', { defaultValue: 'New purchase order' })}</Button>} />
            : (
              <>
                <p className="mb-3 text-2xl font-semibold tabular-nums text-content-primary">{M(value)} <span className="text-xs font-normal text-content-tertiary">{t('home.biz_orders_count', { defaultValue: '{{count}} orders', count: open.length })}</span></p>
                <ul className="space-y-1.5">
                  {open.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')).slice(0, 4).map((o) => (
                    <li key={o.id}>
                      <Link to={`/purchasing/orders/${o.id}`} className="flex items-center gap-3 rounded text-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue">
                        <span className="min-w-0 flex-1 truncate text-content-primary">{o.supplier_name || o.number}</span>
                        <span className="shrink-0 text-xs text-content-tertiary">{o.due_date ? <DateDisplay value={o.due_date} /> : o.number}</span>
                        <span className="shrink-0 tabular-nums text-content-secondary">{M(num(o.gross_total))}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ),
      };
    }
    if (widget === 'utilization') {
      const pct = Math.min(100, Math.round((bookedHours / 8) * 100));
      const next = todayBookings.find((b) => b.start_at > now.toISOString());
      return {
        testId: 'biz-industry',
        title: t('home.biz_utilization', { defaultValue: 'Utilisation today' }),
        subtitle: t('home.biz_utilization_sub', { defaultValue: 'Booked hours against an 8-hour day' }),
        action: <CardLink to="/appointments">{t('home.biz_calendar', { defaultValue: 'Calendar' })}</CardLink>,
        body: bookings.isLoading ? <Lines n={2} /> : bookings.isError ? <CardError onRetry={() => void bookings.refetch()} /> : (
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums text-content-primary">{pct}%</span>
              <span className="text-xs text-content-tertiary">{t('home.biz_booked', { defaultValue: '{{count}} bookings · {{hours}} h', count: todayBookings.length, hours: fmtFixed(bookedHours, 1) })}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-secondary" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full rounded-full ${pct >= 85 ? 'bg-semantic-success' : pct >= 40 ? 'bg-oe-blue' : 'bg-semantic-warning'}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-3 text-xs text-content-secondary">
              {next ? t('home.biz_next_booking', { defaultValue: 'Next: {{who}}', who: next.client_name || '—' }) : t('home.biz_no_more_bookings', { defaultValue: 'No more bookings today — share your booking link to fill gaps.' })}
              {next && <> · <DateDisplay value={next.start_at} format="time" /></>}
            </p>
          </div>
        ),
      };
    }
    const st = salesStats.data;
    return {
      testId: 'biz-industry',
      title: t('home.biz_pipeline', { defaultValue: 'Sales pipeline' }),
      subtitle: t('home.biz_pipeline_sub', { defaultValue: 'Open quotes and orders waiting to be invoiced' }),
      action: <CardLink to="/sales?tab=quotes">{t('home.biz_view_all', { defaultValue: 'View all' })}</CardLink>,
      body: salesStats.isLoading ? <Lines n={3} /> : salesStats.isError || !st ? <CardError onRetry={() => void salesStats.refetch()} /> : (
        <dl className="grid grid-cols-3 gap-3">
          {[
            { k: t('home.biz_open_quotes', { defaultValue: 'Open quotes' }), v: M(num(st.open_quotes_value), true), m: String(st.open_quotes_count), to: '/sales?tab=quotes&status=sent' },
            { k: t('home.biz_to_invoice', { defaultValue: 'To invoice' }), v: M(num(st.orders_to_invoice_value), true), m: String(st.orders_to_invoice_count), to: '/sales?tab=orders' },
            { k: t('home.biz_win_rate', { defaultValue: 'Win rate' }), v: st.win_rate == null ? '—' : `${Math.round(st.win_rate * (st.win_rate <= 1 ? 100 : 1))}%`, m: '', to: '/sales?tab=quotes' },
          ].map((x) => (
            <Link key={x.k} to={x.to} className="rounded-lg bg-surface-secondary/60 p-3 hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue">
              <dt className="text-[11px] text-content-tertiary">{x.k}</dt>
              <dd className="mt-1 text-base font-semibold tabular-nums text-content-primary">{x.v}</dd>
              {x.m && <dd className="text-[11px] text-content-tertiary">{x.m}</dd>}
            </Link>
          ))}
        </dl>
      ),
    };
  }

  const renderColumn = (ids: string[]) => {
    const list = layout.ordered.filter((id) => ids.includes(id) && (editing || !layout.hidden.has(id)));
    return list.map((id, i) => {
      const c = cards[id]!;
      return (
        <HomeCard key={id} testId={c.testId} title={c.title} subtitle={c.subtitle} action={c.action}
          customize={editing ? {
            hidden: layout.hidden.has(id), onToggle: () => layout.toggle(id),
            onUp: i > 0 ? () => layout.move(id, -1, ids) : undefined,
            onDown: i < list.length - 1 ? () => layout.move(id, 1, ids) : undefined,
          } : undefined}>
          {c.body}
        </HomeCard>
      );
    });
  };

  const cashTone: Tone = cashNow === null ? 'neutral' : cashNow < 0 || lowPoint.balance < 0 ? 'danger' : net30 < 0 ? 'warn' : 'ok';

  return (
    <div className={PAGE_CONTAINER_CLS}>
      <PageHeader
        srTitle={t('nav.dashboard', { defaultValue: 'Dashboard' })}
        subtitle={[firstName ? `${greeting}, ${firstName}` : greeting, companyName, dateLabel].filter(Boolean).join(' · ')}
        actions={
          <>
            <ModuleGuideButton content={businessHomeGuide} />
            <Button variant="ghost" size="sm" icon={<LayoutGrid size={14} />} onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
              {editing ? t('home.biz_done', { defaultValue: 'Done' }) : t('home.biz_customize', { defaultValue: 'Customize' })}
            </Button>
            {editing && (
              <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={layout.reset}>{t('home.biz_reset_layout', { defaultValue: 'Reset' })}</Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => navigate('/sales/quotes/new')}>{t('home.biz_action_quote', { defaultValue: 'New quote' })}</Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('/purchasing/orders/new')}>{t('home.biz_action_po', { defaultValue: 'New purchase order' })}</Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('/purchasing/bills/new')}>{t('home.biz_action_bill', { defaultValue: 'Record bill' })}</Button>
            <details className="relative">
              <summary className="flex h-8 cursor-pointer list-none items-center gap-1 rounded-lg border border-border-light bg-surface-elevated px-3 text-sm font-medium text-content-primary hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue [&::-webkit-details-marker]:hidden">
                {t('home.biz_more', { defaultValue: 'More' })}<ChevronDown className="h-4 w-4" aria-hidden />
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-border-light bg-surface-elevated p-1 shadow-lg">
                {moreActions.map((a) => (
                  <Link key={a.to} to={a.to} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-content-primary hover:bg-surface-secondary">
                    <a.icon className="h-4 w-4 text-content-tertiary" aria-hidden />{a.label}
                  </Link>
                ))}
              </div>
            </details>
            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => navigate('/sales/invoices/new')}>
              {t('home.biz_action_invoice', { defaultValue: 'New invoice' })}
            </Button>
          </>
        }
      />

      {isAdmin && <SetupChecklist />}

      {sampleCase && (
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-oe-blue/40 bg-oe-blue/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid="biz-sample-cta">
          <div className="min-w-0">
            <p className="text-sm font-medium text-content-primary">{t('home.biz_sample_title', { defaultValue: 'Nothing here yet' })}</p>
            <p className="mt-0.5 text-xs text-content-secondary">
              {t('home.biz_sample_body', { defaultValue: 'Load {{company}} to see the dashboard, invoices and reports with realistic records.', company: sampleCase.company })}
            </p>
          </div>
          <Link to="/settings?tab=advanced" className="shrink-0 rounded-md bg-oe-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-oe-blue/90">
            {t('home.biz_sample_cta', { defaultValue: 'Explore with sample data' })}
          </Link>
        </div>
      )}

      {/* hero: where the money stands and where it goes next */}
      <section data-testid="biz-hero" aria-label={t('home.biz_hero', { defaultValue: 'Cash position' })}
        className="relative overflow-hidden rounded-2xl border border-border-light bg-gradient-to-br from-oe-blue/[0.07] via-surface-elevated to-surface-elevated shadow-xs">
        <div className="grid grid-cols-1 divide-y divide-border-light md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:divide-x md:divide-y-0">
          <Link to="/banking" className="group block p-5 transition-colors hover:bg-oe-blue/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-oe-blue sm:p-6">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-content-tertiary">
              <Landmark className="h-3.5 w-3.5" aria-hidden />{t('home.biz_kpi_cash', { defaultValue: 'Cash in bank' })}
            </p>
            {bankAccounts.isLoading || (hasBank && bsNow.isLoading) ? <Skeleton className="mt-3 h-10 w-48" />
              : bsNow.isError ? <div className="mt-3"><CardError onRetry={() => void bsNow.refetch()} /></div>
                : cashNow === null ? (
                  <p className="mt-3 text-sm text-oe-blue">{t('home.biz_kpi_cash_empty', { defaultValue: 'Add a bank account to see your balance' })} →</p>
                ) : (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <span className="text-4xl font-semibold tracking-tight tabular-nums text-content-primary">{M(cashNow)}</span>
                      <Delta pct={cashPrev !== null ? pctChange(cashNow, cashPrev) : null} />
                    </div>
                    <p className="mt-1 text-xs text-content-tertiary">{t('home.biz_kpi_cash_ctx', { defaultValue_one: '{{count}} bank account', defaultValue: '{{count}} bank accounts', count: (bankAccounts.data ?? []).length })}</p>
                  </>
                )}
          </Link>
          <Link to="/receivables" className="group block p-5 transition-colors hover:bg-oe-blue/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-oe-blue sm:p-6">
            <p className="text-xs font-medium uppercase tracking-wider text-content-tertiary">{t('home.biz_net_flow_30', { defaultValue: 'Net cash flow · next 30 days' })}</p>
            {flowsLoading ? <Skeleton className="mt-3 h-10 w-40" /> : (
              <div className="mt-2 flex items-end justify-between gap-4">
                <div>
                  <span className={`text-3xl font-semibold tracking-tight tabular-nums ${net30 < 0 ? 'text-semantic-error' : 'text-content-primary'}`}><MoneyDisplay amount={net30} currency={currency} signDisplay="exceptZero" /></span>
                  <p className="mt-1 text-xs text-content-tertiary">
                    <span className="text-semantic-success">{M(in30, true)}</span> {t('home.biz_in', { defaultValue: 'in' })} · <span className="text-semantic-warning">{M(Math.abs(out30), true)}</span> {t('home.biz_out', { defaultValue: 'out' })}
                  </p>
                </div>
                <Sparkline values={next30.map((p) => p.balance)} width={140} height={44} className={net30 < 0 ? 'text-semantic-error' : 'text-semantic-success'} />
              </div>
            )}
            <p className={`mt-3 text-[11px] ${cashTone === 'danger' ? 'text-semantic-error' : 'text-content-tertiary'}`}>
              {cashTone === 'danger'
                ? t('home.biz_cash_warn', { defaultValue: 'Balance dips below zero within {{count}} days — chase receivables or move bill dates.', count: horizon })
                : t('home.biz_cash_why', { defaultValue: 'Open invoices and bills by due date. Overdue amounts count as due today.' })}
            </p>
          </Link>
        </div>
      </section>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label={t('home.biz_kpi_receivables', { defaultValue: 'Receivables' })} to="/receivables"
          loading={summary.isLoading} error={summary.isError} onRetry={() => void summary.refetch()}
          value={sm ? M(num(sm.receivables)) : null} tone={overdueCount ? 'danger' : 'ok'}
          context={overdueCount ? t('home.biz_kpi_overdue', { defaultValue: '{{count}} overdue', count: overdueCount }) : t('home.biz_kpi_none_overdue', { defaultValue: 'Nothing overdue' })}
          why={t('home.biz_kpi_receivables_why', { defaultValue: 'Money customers owe you. Overdue first — it is your cheapest financing.' })}
        />
        <KpiTile
          label={t('home.biz_kpi_payables', { defaultValue: 'Payables' })} to="/purchasing?tab=bills"
          loading={purch.isLoading && !sm} error={purch.isError && !sm} onRetry={() => void purch.refetch()}
          value={payables !== null ? M(payables) : null} tone={billsDueWeekValue > 0 ? 'warn' : 'neutral'}
          context={t('home.biz_kpi_due_week', { defaultValue: '{{value}} due this week', value: money(billsDueWeekValue) })}
          empty={t('home.biz_kpi_no_bills', { defaultValue: 'No supplier bills yet' })}
          why={t('home.biz_kpi_payables_why', { defaultValue: 'What you owe suppliers. Pay on time, not early, to keep cash in hand.' })}
        />
        <KpiTile
          label={t('home.biz_kpi_revenue', { defaultValue: 'Revenue this month' })} to="/sales?tab=invoices"
          loading={summary.isLoading} error={summary.isError} onRetry={() => void summary.refetch()}
          value={sm ? M(revNow) : null} delta={<Delta pct={pctChange(revNow, revPrev)} />}
          tone={revPrev > 0 && revNow < revPrev * 0.8 ? 'warn' : 'ok'} spark={months.slice(-6).map((m) => m.revenue)}
          context={revPrev > 0
            ? t('home.biz_kpi_last_month', { defaultValue: 'Last month {{value}}', value: money(revPrev) })
            : t('home.biz_kpi_open_sales', { defaultValue: 'Open quotes & orders {{value}}', value: money(num(sm?.open_quotes_value) + num(sm?.open_orders_value)) })}
          why={t('home.biz_kpi_revenue_why', { defaultValue: 'Invoiced, net of tax. The month is not over — compare the trend, not the total.' })}
        />
        <KpiTile
          label={t('home.biz_kpi_result', { defaultValue: 'Result this month' })} to="/accounting"
          loading={summary.isLoading || bills.isLoading} error={summary.isError} onRetry={() => void summary.refetch()}
          value={sm ? M(netNow) : null} delta={<Delta pct={pctChange(netNow, netPrev)} />}
          tone={netNow < 0 ? 'danger' : 'ok'} spark={months.slice(-6).map((m) => m.net)}
          context={revNow > 0 ? t('home.biz_kpi_margin', { defaultValue: '{{pct}}% of revenue kept', pct: Math.round((netNow / revNow) * 100) }) : undefined}
          why={t('home.biz_kpi_result_why', { defaultValue: 'Revenue minus supplier bills booked this month.' })}
        />
      </div>

      {/* main + rail */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">{renderColumn(MAIN_CARDS)}</div>
        <div className="flex min-w-0 flex-col gap-4">{renderColumn(RAIL_CARDS)}</div>
      </div>

      {showChecklist && (
        <section className="rounded-2xl border border-border-light bg-surface-elevated px-5 py-4 shadow-xs" data-testid="biz-checklist" aria-label={t('home.biz_get_started', { defaultValue: 'Get started' })}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-content-primary">{t('home.biz_get_started', { defaultValue: 'Get started' })}</h2>
              <p className="text-xs text-content-tertiary">{t('home.biz_progress', { defaultValue: '{{done}} of {{total}} done', done: doneCount, total: checklist.length })}</p>
            </div>
            <div className="flex items-center gap-3">
              <CardLink to="/cases">{t('home.biz_guided_cases', { defaultValue: 'Guided cases' })}</CardLink>
              <button type="button" onClick={dismissChecklist} className="rounded p-1 text-content-tertiary hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue"
                aria-label={t('home.biz_dismiss', { defaultValue: 'Dismiss' })}><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-secondary" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={checklist.length}>
            <div className="h-full bg-oe-blue transition-all" style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
          </div>
          <ol className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-5">
            {checklist.map((c, i) => (
              <li key={c.key}>
                <Link to={c.to} className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-oe-blue">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums ${c.done ? 'border-oe-blue bg-oe-blue text-white' : 'border-border-light text-content-secondary'}`}>
                    {c.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className={`text-sm ${c.done ? 'text-content-tertiary line-through' : 'text-content-primary'}`}>{c.label}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
