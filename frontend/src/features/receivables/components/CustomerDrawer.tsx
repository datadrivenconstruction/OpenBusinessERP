/** Customer drill-down: open items, payment behaviour, dunning trail and next step, notes and promises. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { BellRing, FileDown, Handshake, ReceiptText, StickyNote, Wallet } from 'lucide-react';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { EmptyState, KpiBand, SideDrawer, SkeletonTable } from '@/shared/ui';
import { fmtNumber } from '@/shared/lib/formatters';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { DateDisplay } from '@/shared/ui/DateDisplay';
import { getErrorMessage } from '@/shared/lib/api';
import { receivablesApi, type CustomerDetail, type FollowUp, type PromiseStatus } from '../api';
import { FollowUpModal } from '../modals/FollowUpModal';
import { BUCKET_LABEL, LETTER_VARIANT, PROMISE_VARIANT } from './shared';

type DrawerTab = 'invoices' | 'payments' | 'dunning' | 'log';
const TABS: { id: DrawerTab; icon: React.ElementType; label: string }[] = [
  { id: 'invoices', icon: ReceiptText, label: 'Open invoices' },
  { id: 'payments', icon: Wallet, label: 'Payments' },
  { id: 'dunning', icon: BellRing, label: 'Dunning' },
  { id: 'log', icon: StickyNote, label: 'Notes & promises' },
];
const cell = 'px-3 py-2';

export function CustomerDrawer({ partnerKey, asOf, onClose }: { partnerKey: string; asOf?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DrawerTab>('invoices');
  const [modal, setModal] = useState<'note' | 'promise' | null>(null);
  const q = useQuery({
    queryKey: ['receivables', 'customer', partnerKey, asOf ?? ''],
    queryFn: () => receivablesApi.customer(partnerKey, asOf),
  });
  const d = q.data;
  const cur = d?.invoices[0]?.currency ?? d?.payments[0]?.currency ?? 'EUR';

  return (
    <SideDrawer
      open
      onClose={onClose}
      busy={modal !== null}
      widthClass="max-w-3xl"
      title={d?.customer_name || t('receivables.customer', { defaultValue: 'Customer' })}
      subtitle={d?.blocked ? t('receivables.blocked', { defaultValue: 'No dunning' }) : undefined}
      headerActions={
        <Button size="sm" variant="ghost" icon={<FileDown size={14} />} disabled={!d?.invoices.length}
          onClick={() => receivablesApi.statement(partnerKey)}>
          {t('receivables.statement', { defaultValue: 'Statement' })}
        </Button>
      }
    >
      {q.isLoading ? (
        <SkeletonTable rows={6} columns={4} />
      ) : q.isError || !d ? (
        <EmptyState title={t('receivables.customer_error', { defaultValue: "We couldn't load this customer." })} description={getErrorMessage(q.error)} />
      ) : (
        <div className="space-y-5">
          <KpiBand
            columns={4}
            size="sm"
            items={[
              { key: 'open', label: t('receivables.kpi_open_short', { defaultValue: 'Open' }), value: <MoneyDisplay amount={d.open_total} currency={cur} />, tone: 'blue' },
              { key: 'over', label: t('receivables.kpi_overdue', { defaultValue: 'Past due' }), value: <MoneyDisplay amount={d.overdue_total} currency={cur} />, tone: Number(d.overdue_total) > 0 ? 'warning' : 'success' },
              {
                key: 'dtp',
                label: t('receivables.avg_days_to_pay', { defaultValue: 'Avg. days to pay' }),
                value: d.stats.avg_days_to_pay ?? '—',
                sub: d.stats.avg_days_late != null
                  ? t('receivables.avg_days_late', { defaultValue: '{{days}} days late on average', days: d.stats.avg_days_late })
                  : t('receivables.no_payments_yet', { defaultValue: 'No payments yet' }),
              },
              {
                key: 'ontime',
                label: t('receivables.on_time', { defaultValue: 'Paid on time' }),
                value: d.stats.on_time_share != null ? `${d.stats.on_time_share}%` : '—',
                sub: Number(d.promised_open) > 0 ? <>{t('receivables.promised', { defaultValue: 'Promised' })} <MoneyDisplay amount={d.promised_open} currency={cur} /></> : undefined,
              },
            ]}
          />
          <div className="flex gap-1 border-b border-border-light" role="tablist">
            {TABS.map(({ id, icon: Icon, label }) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={clsx('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium',
                  tab === id ? 'border-oe-blue text-oe-blue' : 'border-transparent text-content-secondary hover:text-content-primary')}>
                <Icon size={14} />
                {t(`receivables.drawer_tab_${id}`, { defaultValue: label })}
              </button>
            ))}
          </div>
          {tab === 'invoices' && <InvoicesPane d={d} />}
          {tab === 'payments' && <PaymentsPane d={d} />}
          {tab === 'dunning' && <DunningPane d={d} />}
          {tab === 'log' && <LogPane d={d} currency={cur} onAdd={setModal} />}
        </div>
      )}
      {d && modal && (
        <FollowUpModal open onClose={() => setModal(null)} kind={modal} partnerKey={partnerKey}
          customerName={d.customer_name} invoices={d.invoices} />
      )}
    </SideDrawer>
  );
}

function InvoicesPane({ d }: { d: CustomerDetail }) {
  const { t } = useTranslation();
  if (!d.invoices.length) return <EmptyState title={t('receivables.no_open_items', { defaultValue: 'Nothing open for this customer.' })} />;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-content-tertiary">
        <tr>
          <th className={cell}>{t('receivables.col_invoice', { defaultValue: 'Invoice' })}</th>
          <th className={cell}>{t('receivables.col_due', { defaultValue: 'Due' })}</th>
          <th className={cell}>{t('receivables.col_bucket', { defaultValue: 'Age' })}</th>
          <th className={clsx(cell, 'text-right')}>{t('receivables.col_open', { defaultValue: 'Open' })}</th>
        </tr>
      </thead>
      <tbody>
        {d.invoices.map((i) => (
          <tr key={i.id} className="border-t border-border-light">
            <td className={clsx(cell, 'font-medium')}>{i.number}</td>
            <td className={cell}><DateDisplay value={i.due_date ?? i.doc_date} /></td>
            <td className={cell}>
              <Badge variant={i.days_overdue > 60 ? 'error' : i.days_overdue > 0 ? 'warning' : 'success'}>
                {i.days_overdue > 0
                  ? t('receivables.days_overdue', { defaultValue: '{{count}} days overdue', count: i.days_overdue })
                  : t(`receivables.bucket_${i.bucket}`, { defaultValue: BUCKET_LABEL[i.bucket] })}
              </Badge>
            </td>
            <td className={clsx(cell, 'text-right tabular-nums')}>
              <MoneyDisplay amount={i.open} currency={i.currency} />
              {i.open_base && i.fx_rate && Number(i.fx_rate) !== 1 && (
                <div className="text-xs text-content-tertiary" title={t('receivables.base_at_doc_rate', { defaultValue: 'Base currency at invoice rate {{rate}}', rate: i.fx_rate })}>
                  {t('receivables.base_short', { defaultValue: 'Base' })} {fmtNumber(i.open_base)}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PaymentsPane({ d }: { d: CustomerDetail }) {
  const { t } = useTranslation();
  if (!d.payments.length) return <EmptyState title={t('receivables.no_payments_yet', { defaultValue: 'No payments yet' })} />;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-content-tertiary">
        <tr>
          <th className={cell}>{t('receivables.col_paid_on', { defaultValue: 'Paid on' })}</th>
          <th className={cell}>{t('receivables.col_invoice', { defaultValue: 'Invoice' })}</th>
          <th className={cell}>{t('receivables.col_timing', { defaultValue: 'Timing' })}</th>
          <th className={clsx(cell, 'text-right')}>{t('receivables.col_amount', { defaultValue: 'Amount' })}</th>
        </tr>
      </thead>
      <tbody>
        {d.payments.map((p) => (
          <tr key={p.id} className="border-t border-border-light">
            <td className={cell}><DateDisplay value={p.pay_date} /></td>
            <td className={cell}>{p.invoice_number}{p.reference && <span className="block text-xs text-content-tertiary">{p.reference}</span>}</td>
            <td className={cell}>
              <span className="text-content-secondary">{t('receivables.after_days', { defaultValue: 'after {{count}} days', count: p.days_to_pay })}</span>{' '}
              {p.days_late > 0
                ? <Badge variant="warning">{t('receivables.late_by', { defaultValue: '{{count}} days late', count: p.days_late })}</Badge>
                : <Badge variant="success">{t('receivables.on_time_badge', { defaultValue: 'on time' })}</Badge>}
            </td>
            <td className={clsx(cell, 'text-right tabular-nums')}><MoneyDisplay amount={p.amount} currency={p.currency} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DunningPane({ d }: { d: CustomerDetail }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-tertiary">
          {t('receivables.next_step', { defaultValue: 'Next run would draft' })}
        </h3>
        {d.blocked ? (
          <p className="text-sm text-content-secondary">{t('receivables.blocked_hint', { defaultValue: 'This customer is excluded from dunning.' })}</p>
        ) : d.next_dunning.length === 0 ? (
          <p className="text-sm text-content-secondary">{t('receivables.nothing_due', { defaultValue: 'No reminder is due yet.' })}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d.next_dunning.map((p) => (
              <li key={p.invoice_id} className="flex justify-between gap-2 rounded border border-border-light px-3 py-1.5">
                <span>{p.invoice_number} · {t('receivables.level', { defaultValue: 'Level' })} {p.level} · {p.days_overdue} {t('receivables.days', { defaultValue: 'days' })}</span>
                <MoneyDisplay amount={p.outstanding} currency={p.currency} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-tertiary">
          {t('receivables.trail', { defaultValue: 'Reminders so far' })}
        </h3>
        {d.letters.length === 0 ? (
          <p className="text-sm text-content-secondary">{t('receivables.no_reminders', { defaultValue: 'No reminders yet.' })}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d.letters.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 border-b border-border-light py-1.5">
                <span><DateDisplay value={l.letter_date} /> · {l.invoice_number} · {t('receivables.level', { defaultValue: 'Level' })} {l.level}</span>
                <Badge variant={LETTER_VARIANT[l.status]} dot>{t(`receivables.status_${l.status}`, { defaultValue: l.status })}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LogPane({ d, currency, onAdd }: { d: CustomerDetail; currency: string; onAdd: (k: 'note' | 'promise') => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" icon={<Handshake size={14} />} onClick={() => onAdd('promise')}>
          {t('receivables.add_promise', { defaultValue: 'Log promise' })}
        </Button>
        <Button size="sm" variant="ghost" icon={<StickyNote size={14} />} onClick={() => onAdd('note')}>
          {t('receivables.add_note', { defaultValue: 'Add note' })}
        </Button>
      </div>
      {d.followups.length === 0 ? (
        <EmptyState title={t('receivables.log_empty', { defaultValue: 'No notes or promises yet.' })} />
      ) : (
        <ul className="space-y-2">{d.followups.map((f) => <FollowUpItem key={f.id} f={f} currency={currency} />)}</ul>
      )}
    </div>
  );
}

export function FollowUpItem({ f, currency, showCustomer = false }: { f: FollowUp; currency: string; showCustomer?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['receivables'] });
  const setStatus = useMutation({ mutationFn: (s: PromiseStatus) => receivablesApi.setPromiseStatus(f.id, s), onSuccess: done });
  const remove = useMutation({ mutationFn: () => receivablesApi.deleteFollowUp(f.id), onSuccess: done });
  const busy = setStatus.isPending || remove.isPending;
  return (
    <li className="rounded-lg border border-border-light px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          {f.kind === 'promise' ? <Handshake size={14} className="text-oe-blue" /> : <StickyNote size={14} className="text-content-tertiary" />}
          {showCustomer && <span className="font-medium">{f.customer_name}</span>}
          {f.kind === 'promise' && f.promised_amount && (
            <span className="font-medium tabular-nums"><MoneyDisplay amount={f.promised_amount} currency={currency} /></span>
          )}
          {f.promised_date && <span className="text-content-secondary">{t('receivables.by_date', { defaultValue: 'by' })} <DateDisplay value={f.promised_date} /></span>}
          {f.invoice_number && <span className="text-xs text-content-tertiary">{f.invoice_number}</span>}
          {f.kind === 'promise' && f.status && (
            <Badge variant={f.overdue ? 'error' : PROMISE_VARIANT[f.status]} dot>
              {f.overdue ? t('receivables.promise_late', { defaultValue: 'Date passed' }) : t(`receivables.promise_${f.status}`, { defaultValue: f.status })}
            </Badge>
          )}
        </span>
        <span className="flex gap-1">
          {f.kind === 'promise' && f.status === 'open' && (
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus.mutate('kept')}>{t('receivables.mark_kept', { defaultValue: 'Kept' })}</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus.mutate('broken')}>{t('receivables.mark_broken', { defaultValue: 'Broken' })}</Button>
            </>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove.mutate()}>{t('common.delete', { defaultValue: 'Delete' })}</Button>
        </span>
      </div>
      {f.text && <p className="mt-1 whitespace-pre-line text-content-secondary">{f.text}</p>}
      <p className="mt-1 text-xs text-content-tertiary"><DateDisplay value={f.created_at} /></p>
    </li>
  );
}
