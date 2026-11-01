/** Read-only side cards of a sales document: related documents, payments, activity, attachments. */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpLeft, CreditCard, History, Paperclip } from 'lucide-react';
import { Badge, Button, DateDisplay, MoneyDisplay } from '@/shared/ui';
import { STATUS_VARIANT, kindPath, type ActivityEntry, type RelatedDocs, type SalesDoc, type SalesDocSummary } from '../api';

const card = 'rounded-xl border border-border-light bg-surface-elevated p-4 shadow-xs';
const h2 = 'mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-tertiary';

function DocLink({ d, icon }: { d: SalesDocSummary; icon: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <Link to={`/sales/${kindPath(d.kind)}/${d.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-secondary">
      {icon}
      <span className="text-xs text-content-tertiary">{t(`sales.kind_${d.kind}`, { defaultValue: d.kind.replace('_', ' ') })}</span>
      <span className="font-mono text-xs text-content-primary">{d.number}</span>
      <Badge size="sm" variant={STATUS_VARIANT[d.status] ?? 'neutral'} className="ml-auto">
        {t(`sales.status_${d.status}`, { defaultValue: d.status.replace('_', ' ') })}
      </Badge>
    </Link>
  );
}

export function RelatedDocsCard({ related }: { related: RelatedDocs | undefined }) {
  const { t } = useTranslation();
  if (!related || (!related.source && !related.derived.length)) return null;
  return (
    <section className={card}>
      <h2 className={h2}>{t('sales.related.title', { defaultValue: 'Related documents' })}</h2>
      {related.source && <DocLink d={related.source} icon={<ArrowUpLeft size={14} className="text-content-tertiary" />} />}
      {related.derived.map((d) => (
        <DocLink key={d.id} d={d} icon={<ArrowDownRight size={14} className="text-content-tertiary" />} />
      ))}
    </section>
  );
}

export function PaymentsCard({ doc, onRecord }: { doc: SalesDoc; onRecord?: () => void }) {
  const { t } = useTranslation();
  return (
    <section className={card}>
      <div className="flex items-center justify-between">
        <h2 className={h2}>
          <CreditCard size={12} />
          {t('sales.payments', { defaultValue: 'Payments' })}
        </h2>
        {onRecord && (
          <Button size="sm" variant="ghost" onClick={onRecord}>
            {t('sales.record_payment', { defaultValue: 'Record payment' })}
          </Button>
        )}
      </div>
      {doc.payments.length === 0 ? (
        <p className="text-sm text-content-tertiary">{t('sales.no_payments', { defaultValue: 'No payments recorded' })}</p>
      ) : (
        <ul className="divide-y divide-border-light text-sm">
          {doc.payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-content-secondary">
                <DateDisplay value={p.pay_date} />
                {p.reference && <span className="ml-1 text-content-tertiary">· {p.reference}</span>}
                {p.fx_rate && <span className="ml-1 text-content-tertiary">· {t('sales.payment_rate', { defaultValue: 'Rate {{rate}}', rate: Number(p.fx_rate).toFixed(4) })}</span>}
              </span>
              <MoneyDisplay amount={p.amount} currency={doc.currency} className="font-medium tabular-nums" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ActivityCard({ entries, loading }: { entries: ActivityEntry[] | undefined; loading: boolean }) {
  const { t } = useTranslation();
  return (
    <section className={card}>
      <h2 className={h2}>
        <History size={12} />
        {t('sales.activity.title', { defaultValue: 'Activity' })}
      </h2>
      {loading ? (
        <p className="text-sm text-content-tertiary">…</p>
      ) : !entries?.length ? (
        <p className="text-sm text-content-tertiary">{t('sales.activity.empty', { defaultValue: 'No activity yet' })}</p>
      ) : (
        <ol className="space-y-2 border-l border-border-light pl-3">
          {entries.map((a, i) => (
            <li key={`${a.at}-${i}`} className="relative text-sm">
              <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-oe-blue" />
              <p className="text-content-primary">{a.message}</p>
              <p className="text-2xs text-content-tertiary">
                <DateDisplay value={a.at} format="datetime" />
                {a.actor && ` · ${a.actor}`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** No shared attachments widget exists yet; point to the Documents module instead. */
export function AttachmentsCard() {
  const { t } = useTranslation();
  return (
    <section className={card}>
      <h2 className={h2}>
        <Paperclip size={12} />
        {t('sales.attachments.title', { defaultValue: 'Attachments' })}
      </h2>
      <p className="text-sm text-content-tertiary">
        {t('sales.attachments.hint', { defaultValue: 'Store signed copies and supporting files in' })}{' '}
        <Link to="/documents" className="text-oe-blue hover:underline">
          {t('sales.attachments.link', { defaultValue: 'Documents' })}
        </Link>
      </p>
    </section>
  );
}
