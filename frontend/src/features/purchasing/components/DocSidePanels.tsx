/** Read-side panels of the document page: payments, related documents, activity log. */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { DateDisplay } from '@/shared/ui/DateDisplay';
import type { PurchasingDoc, RelatedRef } from '../api';
import { usePurchasingActivity, usePurchasingRelated } from '../hooks';
import type { PurchasingKind } from '../api';
import { Section, StatusBadge } from './common';
import { fmtNumber } from '@/shared/lib/formatters';

export function PaymentsCard({ doc, canPay, onPay }: { doc: PurchasingDoc; canPay: boolean; onPay: () => void }) {
  const { t } = useTranslation();
  const pays = doc.payments ?? [];
  return (
    <Section
      title={t('purchasing.payments', { defaultValue: 'Payments' })}
      actions={
        canPay && (
          <Button size="sm" variant="secondary" icon={<CreditCard size={14} />} onClick={onPay}>
            {t('purchasing.record_payment', { defaultValue: 'Record payment' })}
          </Button>
        )
      }
    >
      {pays.length === 0 ? (
        <p className="text-sm text-content-tertiary">{t('purchasing.no_payments', { defaultValue: 'No payments recorded' })}</p>
      ) : (
        <ul className="divide-y divide-border-light text-sm">
          {pays.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-1.5">
              <span className="text-content-secondary">
                <DateDisplay value={p.pay_date} /> {p.method && <span className="ml-1">· {p.method}</span>} {p.reference && <span className="ml-1">· {p.reference}</span>} {p.fx_rate && <span className="ml-1 text-content-tertiary">· {t('sales.payment_rate', { defaultValue: 'Rate {{rate}}', rate: fmtNumber(p.fx_rate, 4) })}</span>}
              </span>
              <MoneyDisplay amount={p.amount} currency={doc.currency} className="tabular-nums" />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function RefRow({ to, r, label }: { to: string; r: RelatedRef; label: string }) {
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <span className="min-w-0">
        <span className="mr-1.5 text-2xs uppercase text-content-tertiary">{label}</span>
        <Link to={to} className="font-mono text-xs text-content-primary hover:underline">{r.number}</Link>
      </span>
      <span className="flex items-center gap-2">
        {r.status && <StatusBadge status={r.status} size="sm" />}
        {(r.gross_total ?? r.value_total) && <MoneyDisplay amount={r.gross_total ?? r.value_total} currency={r.currency} className="tabular-nums text-xs" />}
      </span>
    </li>
  );
}

export function RelatedDocs({ kind, id }: { kind: PurchasingKind; id: string }) {
  const { t } = useTranslation();
  const { data, isError } = usePurchasingRelated(kind, id);
  if (isError || !data) return null;
  const L = {
    order: t('purchasing.ref_order', { defaultValue: 'PO' }),
    receipt: t('purchasing.ref_receipt', { defaultValue: 'Receipt' }),
    bill: t('purchasing.ref_bill', { defaultValue: 'Bill' }),
  };
  const items: React.ReactNode[] = [];
  if (data.kind === 'order') {
    data.order.derived.receipts.forEach((r) => items.push(<RefRow key={r.id} to={`/purchasing?tab=receipts&q=${encodeURIComponent(r.number)}`} r={r} label={L.receipt} />));
    data.order.derived.bills.forEach((r) => items.push(<RefRow key={r.id} to={`/purchasing/bills/${r.id}`} r={r} label={L.bill} />));
  } else {
    const s = data.bill.source;
    if (s?.order) items.push(<RefRow key={s.order.id} to={`/purchasing/orders/${s.order.id}`} r={s.order} label={L.order} />);
    if (s?.receipt) items.push(<RefRow key={s.receipt.id} to={`/purchasing?tab=receipts&q=${encodeURIComponent(s.receipt.number)}`} r={s.receipt} label={L.receipt} />);
    data.bill.derived.forEach((r) => items.push(<RefRow key={r.id} to={`/purchasing/credit-notes/${r.id}`} r={r} label={t('purchasing.ref_credit', { defaultValue: 'Credit' })} />));
  }
  return (
    <Section title={t('purchasing.related', { defaultValue: 'Related documents' })}>
      {items.length ? <ul className="divide-y divide-border-light">{items}</ul> : <p className="text-sm text-content-tertiary">{t('purchasing.related_none', { defaultValue: 'Nothing linked yet' })}</p>}
    </Section>
  );
}

export function ActivityLog({ kind, id }: { kind: PurchasingKind; id: string }) {
  const { t } = useTranslation();
  const { data, isError } = usePurchasingActivity(kind, id);
  if (isError) return null;
  return (
    <Section title={t('purchasing.activity', { defaultValue: 'Activity' })}>
      {!data?.length ? (
        <p className="text-sm text-content-tertiary">{t('purchasing.activity_none', { defaultValue: 'No activity yet' })}</p>
      ) : (
        <ol className="relative space-y-3 border-l border-border-light pl-4">
          {data.map((a, i) => (
            <li key={`${a.at}-${i}`} className="relative text-sm">
              <span className="absolute -left-[21px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface-elevated bg-oe-blue" />
              <div className="text-content-primary">{a.message}</div>
              <div className="text-xs text-content-tertiary">
                <DateDisplay value={a.at} format="relative" />
                {a.actor && <> · {a.actor}</>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
