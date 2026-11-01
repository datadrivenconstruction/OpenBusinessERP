import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, History, Pause, Pencil, Play, Plus, Repeat, Trash2, Zap } from 'lucide-react';
import { Badge, Breadcrumb, Button, ConfirmDialog, EmptyState, SkeletonTable, StatCard } from '@/shared/ui';
import type { BadgeVariant } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { ContactSearchInput } from '@/shared/ui/ContactSearchInput';
import { apiGet, getErrorMessage } from '@/shared/lib/api';
import { fmtCurrency } from '@/shared/lib/formatters';
import { useToastStore } from '@/stores/useToastStore';
import { lineTotals } from './api';
import { emptyLine } from './lib/form';
import { LineEditor } from './components/LineEditor';
import { defaultTaxRate, taxRateOptions } from './taxDefaults';
import {
  RECURRING_INTERVALS,
  monthlyValue,
  useRecurringAction,
  useRecurringList,
  useRecurringRuns,
  useRecurringSummary,
  useSaveRecurring,
  type GenerateResult,
  type RecurringInput,
  type RecurringStatus,
  type RecurringTemplate,
} from './recurringApi';
import { DateField } from '@/shared/ui/DateField';

const input =
  'w-full rounded-lg border border-border-light bg-surface-primary px-2 py-1.5 text-sm text-content-primary focus:border-oe-blue focus:outline-none';
const STATUS_VARIANT: Record<RecurringStatus, BadgeVariant> = { active: 'success', paused: 'warning', ended: 'neutral' };
const INTERVAL_LABEL = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' } as const;
const today = () => new Date().toISOString().slice(0, 10);

function blankForm(currency: string, tax: string): RecurringInput {
  return {
    name: '',
    customer_id: null,
    customer_name: '',
    customer_email: '',
    customer_address: '',
    currency,
    notes: '',
    interval: 'monthly',
    interval_count: 1,
    start_date: today(),
    end_date: null,
    max_count: null,
    day_of_month: null,
    payment_terms_days: 14,
    auto_issue: true,
    auto_send: false,
    lines: [emptyLine(tax)],
  };
}

function toInput(r: RecurringTemplate): RecurringInput {
  const { id: _id, status: _s, net_total: _n, gross_total: _g, next_run_date: _nr, generated_count: _gc, last_document_id: _ld, last_run_at: _lr, last_error: _le, created_at: _c, ...rest } = r;
  return { ...rest, lines: r.lines.map((l) => ({ ...l, tax_rate: String(l.tax_rate ?? '0') })) };
}

export function RecurringInvoicesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToastStore((s) => s.addToast);
  const list = useRecurringList();
  const summary = useRecurringSummary();
  const action = useRecurringAction();
  const settings = useQuery({
    queryKey: ['business-settings'],
    queryFn: () => apiGet<{ base_currency?: string | null; country_code?: string | null }>('/v1/business-settings/'),
    retry: false,
  });
  const countryTax = defaultTaxRate(settings.data?.country_code);
  const baseCur = settings.data?.base_currency || 'EUR';
  const [editing, setEditing] = useState<{ id?: string; form: RecurringInput } | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const fail = (e: unknown) => toast({ type: 'error', title: getErrorMessage(e) });
  const intervalText = (r: Pick<RecurringTemplate, 'interval' | 'interval_count'>) =>
    r.interval_count > 1
      ? t('recurring.every_n', {
          defaultValue: 'Every {{n}} × {{unit}}',
          n: r.interval_count,
          unit: t(`recurring.interval_${r.interval}`, { defaultValue: INTERVAL_LABEL[r.interval] }),
        })
      : t(`recurring.interval_${r.interval}`, { defaultValue: INTERVAL_LABEL[r.interval] });

  const run = (id: string, a: 'pause' | 'resume' | 'generate') =>
    action.mutate(
      { id, action: a },
      {
        onSuccess: (res) => {
          if (a === 'generate') {
            const g = res as GenerateResult;
            toast({
              type: g.status === 'skipped' ? 'warning' : 'success',
              title: t('recurring.generated_toast', { defaultValue: 'Invoice generated for {{date}}', date: g.period_date }),
              message: g.detail || undefined,
            });
          }
        },
        onError: fail,
      },
    );

  const mrrEntries = Object.entries(summary.data?.mrr ?? {});
  const mrrText = mrrEntries.length ? mrrEntries.map(([c, v]) => fmtCurrency(v, c)).join(' · ') : fmtCurrency(0, baseCur);
  const arrText = Object.entries(summary.data?.arr ?? {}).map(([c, v]) => fmtCurrency(v, c)).join(' · ') || '—';

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: t('sales.title', { defaultValue: 'Sales' }), to: '/sales' },
          { label: t('recurring.title', { defaultValue: 'Recurring invoices' }) },
        ]}
      />
      <PageHeader
        srTitle={t('recurring.title', { defaultValue: 'Recurring invoices' })}
        subtitle={t('recurring.subtitle', {
          defaultValue: 'Subscriptions and contracts that turn into invoices on schedule, posted like any other invoice.',
        })}
        actions={
          <Button icon={<Plus size={16} />} onClick={() => setEditing({ form: blankForm(baseCur, String(countryTax)) })}>
            {t('recurring.new', { defaultValue: 'New recurring invoice' })}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('recurring.mrr', { defaultValue: 'Monthly recurring revenue' })} value={mrrText} icon={Repeat} tone="blue" />
        <StatCard label={t('recurring.arr', { defaultValue: 'Annual run rate' })} value={arrText} icon={CalendarClock} />
        <StatCard label={t('recurring.active', { defaultValue: 'Active' })} value={summary.data?.active ?? 0} sub={t('recurring.paused_n', { defaultValue: 'Paused: {{n}}', n: summary.data?.paused ?? 0 })} />
        <StatCard label={t('recurring.due_7', { defaultValue: 'Due in 7 days' })} value={summary.data?.due_next_7_days ?? 0} icon={Zap} />
      </div>

      {list.isLoading ? (
        <SkeletonTable rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Repeat size={28} />}
          title={t('recurring.empty_title', { defaultValue: 'No recurring invoices yet' })}
          description={t('recurring.empty_body', {
            defaultValue: 'Set up a subscription or service contract once; the invoice is created and posted every period.',
          })}
          action={{ label: t('recurring.new', { defaultValue: 'New recurring invoice' }), onClick: () => setEditing({ form: blankForm(baseCur, String(countryTax)) }) }}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-light bg-surface-elevated">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-surface-secondary text-left text-xs text-content-tertiary">
              <tr>
                <th className="px-3 py-2 font-medium">{t('recurring.name', { defaultValue: 'Name' })}</th>
                <th className="px-3 py-2 font-medium">{t('sales.customer', { defaultValue: 'Customer' })}</th>
                <th className="px-3 py-2 font-medium">{t('recurring.interval', { defaultValue: 'Interval' })}</th>
                <th className="px-3 py-2 text-right font-medium">{t('recurring.amount', { defaultValue: 'Amount (net)' })}</th>
                <th className="px-3 py-2 text-right font-medium">{t('recurring.per_month', { defaultValue: 'Per month' })}</th>
                <th className="px-3 py-2 font-medium">{t('recurring.next_run', { defaultValue: 'Next run' })}</th>
                <th className="px-3 py-2 font-medium">{t('recurring.status', { defaultValue: 'Status' })}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border-light align-middle">
                  <td className="px-3 py-2">
                    <button type="button" className="font-medium text-content-primary hover:text-oe-blue" onClick={() => setEditing({ id: r.id, form: toInput(r) })}>
                      {r.name || r.customer_name}
                    </button>
                    {r.last_error && <p className="text-xs text-semantic-error">{r.last_error}</p>}
                  </td>
                  <td className="px-3 py-2 text-content-secondary">{r.customer_name}</td>
                  <td className="px-3 py-2 text-content-secondary">{intervalText(r)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(r.net_total, r.currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-content-secondary">
                    {fmtCurrency(monthlyValue(Number(r.net_total), r.interval, r.interval_count), r.currency)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.next_run_date ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge variant={STATUS_VARIANT[r.status]} size="sm">
                      {t(`recurring.status_${r.status}`, { defaultValue: r.status })}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {r.status === 'active' && (
                        <>
                          <Button size="sm" variant="ghost" icon={<Zap size={14} />} disabled={action.isPending} onClick={() => run(r.id, 'generate')}>
                            {t('recurring.generate_now', { defaultValue: 'Generate now' })}
                          </Button>
                          <Button size="sm" variant="ghost" aria-label={t('recurring.pause', { defaultValue: 'Pause' })} icon={<Pause size={14} />} onClick={() => run(r.id, 'pause')} />
                        </>
                      )}
                      {r.status === 'paused' && (
                        <Button size="sm" variant="ghost" aria-label={t('recurring.resume', { defaultValue: 'Resume' })} icon={<Play size={14} />} onClick={() => run(r.id, 'resume')} />
                      )}
                      <Button size="sm" variant="ghost" aria-label={t('recurring.history', { defaultValue: 'Generated invoices' })} icon={<History size={14} />} onClick={() => setHistoryId(historyId === r.id ? null : r.id)} />
                      <Button size="sm" variant="ghost" aria-label={t('common.edit', { defaultValue: 'Edit' })} icon={<Pencil size={14} />} onClick={() => setEditing({ id: r.id, form: toInput(r) })} />
                      <Button size="sm" variant="ghost" aria-label={t('common.delete', { defaultValue: 'Delete' })} icon={<Trash2 size={14} />} onClick={() => setDeleteId(r.id)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {historyId && <RunHistory id={historyId} name={rows.find((r) => r.id === historyId)?.name ?? ''} onOpen={(docId) => navigate(`/sales/invoices/${docId}`)} />}

      {editing && (
        <RecurringForm
          key={editing.id ?? 'new'}
          id={editing.id}
          initial={editing.form}
          taxRates={taxRateOptions(countryTax, editing.form.lines.map((l) => l.tax_rate))}
          defaultTax={String(countryTax)}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleteId}
        title={t('recurring.delete_title', { defaultValue: 'Delete recurring invoice?' })}
        message={t('recurring.delete_body', { defaultValue: 'Invoices already generated stay in Sales; no new ones will be created.' })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        variant="danger"
        onConfirm={() => deleteId && action.mutate({ id: deleteId, action: 'delete' }, { onSuccess: () => setDeleteId(null), onError: fail })}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

function RunHistory({ id, name, onOpen }: { id: string; name: string; onOpen: (docId: string) => void }) {
  const { t } = useTranslation();
  const runs = useRecurringRuns(id);
  const rows = runs.data ?? [];
  return (
    <section className="rounded-xl border border-border-light bg-surface-elevated p-4">
      <h2 className="mb-3 text-sm font-semibold text-content-primary">
        {t('recurring.history_of', { defaultValue: 'Generated invoices: {{name}}', name })}
      </h2>
      {runs.isLoading ? (
        <SkeletonTable rows={2} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-content-tertiary">{t('recurring.history_empty', { defaultValue: 'Nothing generated yet.' })}</p>
      ) : (
        <ul className="divide-y divide-border-light text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="w-24 tabular-nums text-content-secondary">{r.period_date}</span>
              {r.document_id ? (
                <button type="button" className="font-medium text-oe-blue hover:underline" onClick={() => onOpen(r.document_id!)}>
                  {r.document_number}
                </button>
              ) : (
                <span>—</span>
              )}
              <span className="tabular-nums">{fmtCurrency(r.gross_total)}</span>
              <Badge size="sm" variant={r.status === 'send_failed' || r.status === 'failed' ? 'error' : r.status === 'sent' ? 'success' : 'blue'}>
                {t(`recurring.run_${r.status}`, { defaultValue: r.status })}
              </Badge>
              {r.trigger === 'manual' && <span className="text-xs text-content-tertiary">{t('recurring.manual', { defaultValue: 'manual' })}</span>}
              {r.detail && <span className="text-xs text-content-tertiary">{r.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecurringForm({
  id,
  initial,
  taxRates,
  defaultTax,
  onClose,
}: {
  id?: string;
  initial: RecurringInput;
  taxRates: number[];
  defaultTax: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToastStore((s) => s.addToast);
  const save = useSaveRecurring();
  const [f, setF] = useState<RecurringInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<RecurringInput>) => setF((cur) => ({ ...cur, ...p }));
  const net = f.lines.reduce((s, l) => s + lineTotals(l).net, 0);
  const endMode: 'never' | 'date' | 'count' = f.end_date ? 'date' : f.max_count ? 'count' : 'never';
  const usesDay = f.interval !== 'weekly';

  const submit = () => {
    if (!f.customer_name.trim()) return setError(t('sales.validation.customer', { defaultValue: 'Pick a customer' }));
    if (!f.lines.some((l) => l.description.trim() || l.item_id)) return setError(t('recurring.need_line', { defaultValue: 'Add at least one line' }));
    setError(null);
    const body = { ...f, lines: f.lines.filter((l) => l.description.trim() || l.item_id), day_of_month: usesDay ? f.day_of_month : null };
    save.mutate(
      { id, body },
      {
        onSuccess: () => {
          toast({ type: 'success', title: t('recurring.saved', { defaultValue: 'Recurring invoice saved' }) });
          onClose();
        },
        onError: (e) => setError(getErrorMessage(e)),
      },
    );
  };

  return (
    <section className="space-y-4 rounded-xl border border-oe-blue/40 bg-surface-elevated p-4 shadow-xs" aria-label={t('recurring.form', { defaultValue: 'Recurring invoice' })}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-content-primary">
          {id ? t('recurring.edit', { defaultValue: 'Edit recurring invoice' }) : t('recurring.new', { defaultValue: 'New recurring invoice' })}
        </h2>
        <Link to="/sales" className="text-xs text-content-tertiary hover:text-oe-blue">
          {t('sales.title', { defaultValue: 'Sales' })}
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs text-content-tertiary">
          {t('recurring.name', { defaultValue: 'Name' })}
          <input className={input} value={f.name} placeholder={t('recurring.name_ph', { defaultValue: 'e.g. Support plan' })} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="text-xs text-content-tertiary">
          {t('sales.customer', { defaultValue: 'Customer' })}
          <ContactSearchInput value={f.customer_id ?? ''} displayValue={f.customer_name} onChange={(cid, name) => set({ customer_id: cid || null, customer_name: name })} showBrowse />
        </div>
        <label className="text-xs text-content-tertiary">
          {t('sales.customer_email', { defaultValue: 'Customer e-mail' })}
          <input type="email" className={input} value={f.customer_email} onChange={(e) => set({ customer_email: e.target.value })} />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-6">
        <label className="text-xs text-content-tertiary">
          {t('recurring.interval', { defaultValue: 'Interval' })}
          <select className={input} value={f.interval} onChange={(e) => set({ interval: e.target.value as RecurringInput['interval'] })}>
            {RECURRING_INTERVALS.map((i) => (
              <option key={i} value={i}>
                {t(`recurring.interval_${i}`, { defaultValue: INTERVAL_LABEL[i] })}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-content-tertiary">
          {t('recurring.every', { defaultValue: 'Every' })}
          <input type="number" min={1} max={36} className={input} value={f.interval_count} onChange={(e) => set({ interval_count: Math.max(1, Number(e.target.value) || 1) })} />
        </label>
        <label className="text-xs text-content-tertiary">
          {t('recurring.start_date', { defaultValue: 'First invoice' })}
          <DateField className={input} value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} />
        </label>
        {usesDay && (
          <label className="text-xs text-content-tertiary">
            {t('recurring.day_of_month', { defaultValue: 'Billing day' })}
            <select className={input} value={f.day_of_month ?? ''} onChange={(e) => set({ day_of_month: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t('recurring.day_from_start', { defaultValue: 'Same as first invoice' })}</option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d === 31 ? t('recurring.last_day', { defaultValue: 'Last day of month' }) : d}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs text-content-tertiary">
          {t('recurring.ends', { defaultValue: 'Ends' })}
          <select
            className={input}
            value={endMode}
            onChange={(e) => {
              const m = e.target.value;
              set({ end_date: m === 'date' ? f.end_date || f.start_date : null, max_count: m === 'count' ? f.max_count || 12 : null });
            }}
          >
            <option value="never">{t('recurring.ends_never', { defaultValue: 'Never' })}</option>
            <option value="date">{t('recurring.ends_date', { defaultValue: 'On date' })}</option>
            <option value="count">{t('recurring.ends_count', { defaultValue: 'After N invoices' })}</option>
          </select>
        </label>
        {endMode === 'date' && (
          <label className="text-xs text-content-tertiary">
            {t('recurring.end_date', { defaultValue: 'End date' })}
            <DateField className={input} value={f.end_date ?? ''} onChange={(e) => set({ end_date: e.target.value || null })} />
          </label>
        )}
        {endMode === 'count' && (
          <label className="text-xs text-content-tertiary">
            {t('recurring.max_count', { defaultValue: 'Invoices' })}
            <input type="number" min={1} className={input} value={f.max_count ?? 1} onChange={(e) => set({ max_count: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border-light">
        <LineEditor lines={f.lines} onChange={(lines) => set({ lines })} editable currency={f.currency} taxRates={taxRates} defaultTax={defaultTax} errors={[]} />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-xs text-content-tertiary">
          {t('sales.currency', { defaultValue: 'Currency' })}
          <input className={input} maxLength={3} value={f.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
        </label>
        <label className="text-xs text-content-tertiary">
          {t('recurring.terms_days', { defaultValue: 'Payment terms (days)' })}
          <input type="number" min={0} className={input} value={f.payment_terms_days} onChange={(e) => set({ payment_terms_days: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label className="flex items-center gap-2 text-sm text-content-secondary">
          <input type="checkbox" checked={f.auto_issue} onChange={(e) => set({ auto_issue: e.target.checked, auto_send: e.target.checked && f.auto_send })} />
          {t('recurring.auto_issue', { defaultValue: 'Issue and post automatically' })}
        </label>
        <label className="flex items-center gap-2 text-sm text-content-secondary">
          <input type="checkbox" checked={f.auto_send} disabled={!f.auto_issue} onChange={(e) => set({ auto_send: e.target.checked })} />
          {t('recurring.auto_send', { defaultValue: 'E-mail to customer' })}
        </label>
      </div>
      <label className="block text-xs text-content-tertiary">
        {t('sales.notes', { defaultValue: 'Notes' })}
        <textarea className={`${input} min-h-[56px]`} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-content-secondary">
          {t('recurring.per_period', { defaultValue: 'Net per invoice' })}: <strong className="tabular-nums">{fmtCurrency(net, f.currency)}</strong>
          {' · '}
          {t('recurring.per_month', { defaultValue: 'Per month' })}: <span className="tabular-nums">{fmtCurrency(monthlyValue(net, f.interval, f.interval_count), f.currency)}</span>
        </p>
        <div className="flex items-center gap-2">
          {error && <span className="text-sm text-semantic-error">{error}</span>}
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
        </div>
      </div>
    </section>
  );
}
