import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet, getErrorMessage } from '@/shared/lib/api';
import { Breadcrumb } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { useToastStore } from '@/stores/useToastStore';
import { defaultTaxRate } from '@/features/sales/taxDefaults';
import { MatchChip } from './MatchChip';
import { DOC_KINDS, docKind, purchasingApi, type PurchasingDoc, type PurchasingKind, type PurchasingLine } from './api';
import { addDays, buildTimeline, validateLines } from './helpers';
import { useDuplicateDoc, useInvalidatePurchasing, usePurchasingDoc, usePurchasingRelated } from './hooks';
import { Section, StatusBadge, inputCls } from './components/common';
import { StatusTimeline } from './components/StatusTimeline';
import { SupplierCard } from './components/SupplierCard';
import { LineEditor } from './components/LineEditor';
import { DocTotals } from './components/DocTotals';
import { ActivityLog, PaymentsCard, RelatedDocs } from './components/DocSidePanels';
import { StickyActionBar, useUnsavedGuard, type MoreAction } from './components/StickyActionBar';
import { PdfPreviewPanel } from './components/PdfPreviewPanel';
import { ReceiveDialog } from './modals/ReceiveDialog';
import { PaymentDialog } from './modals/PaymentDialog';

const NEW_LABEL: Record<PurchasingKind, string> = { orders: 'New purchase order', bills: 'New bill', 'credit-notes': 'New credit note' };
const blankLine = (tax: string): PurchasingLine => ({ item_id: null, sku: '', description: '', qty: '1', unit_price: '0', tax_rate: tax, discount_pct: '' });

interface Form {
  supplier_id: string;
  supplier_name: string;
  supplier_ref: string;
  currency: string;
  doc_date: string;
  due_date: string;
  payment_terms_days: string;
  notes: string;
  lines: PurchasingLine[];
}

const toForm = (d?: PurchasingDoc, currency = 'EUR', tax = '0'): Form => ({
  supplier_id: d?.supplier_id ?? '',
  supplier_name: d?.supplier_name ?? '',
  supplier_ref: d?.supplier_ref ?? '',
  currency: d?.currency ?? currency,
  doc_date: d?.doc_date ?? new Date().toISOString().slice(0, 10),
  due_date: d?.due_date ?? '',
  payment_terms_days: d?.payment_terms_days != null ? String(d.payment_terms_days) : '',
  notes: d?.notes ?? '',
  lines: d?.lines.map((l) => ({ ...l, qty: String(l.qty), unit_price: String(l.unit_price), tax_rate: String(l.tax_rate), discount_pct: l.discount_pct != null ? String(l.discount_pct) : '' })) ?? [blankLine(tax)],
});

export function PurchasingDocumentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const invalidate = useInvalidatePurchasing();
  const params = useParams<{ kind: string; id: string }>();
  const kind = (DOC_KINDS.includes(params.kind as PurchasingKind) ? params.kind : 'orders') as PurchasingKind;
  const isOrder = kind === 'orders';
  const isNew = !params.id || params.id === 'new';
  const { data: doc, error: loadError } = usePurchasingDoc(kind, isNew ? undefined : params.id);
  const related = usePurchasingRelated(kind, doc?.id);
  const settings = useQuery({
    queryKey: ['business-settings'],
    queryFn: () => apiGet<{ base_currency?: string | null; country_code?: string | null }>('/v1/business-settings/'),
    retry: false,
  });
  const baseTax = String(defaultTaxRate(settings.data?.country_code));

  const [form, setForm] = useState<Form>(toForm());
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const update = (patch: Partial<Form>) => {
    setDirty(true);
    setForm((f) => ({ ...f, ...patch }));
  };
  useEffect(() => {
    if (isNew && !dirty && settings.data) setForm(toForm(undefined, settings.data.base_currency || 'EUR', baseTax));
  }, [isNew, dirty, settings.data, baseTax]);
  useEffect(() => {
    if (!doc) return;
    setForm(toForm(doc));
    setDirty(false);
    setShowErrors(false);
  }, [doc]);
  useUnsavedGuard(dirty, t('purchasing.leave_confirm', { defaultValue: 'You have unsaved changes. Leave anyway?' }));

  const editable = isNew || doc?.status === 'draft';
  const lineErrors = useMemo(() => validateLines(form.lines), [form.lines]);
  const formErrors = {
    supplier: !form.supplier_name.trim() ? t('purchasing.err_supplier', { defaultValue: 'Choose a supplier' }) : '',
    lines: form.lines.length === 0 ? t('purchasing.err_lines', { defaultValue: 'Add at least one line' }) : '',
    due: form.due_date && form.doc_date && form.due_date < form.doc_date ? t('purchasing.err_due', { defaultValue: 'Due date is before the document date' }) : '',
  };
  const valid = !Object.values(formErrors).some(Boolean) && lineErrors.every((e) => Object.keys(e).length === 0);

  const body = () => ({
    supplier_id: form.supplier_id || null,
    supplier_name: form.supplier_name,
    ...(isOrder ? {} : { supplier_ref: form.supplier_ref }),
    currency: form.currency.toUpperCase(),
    doc_date: form.doc_date || null,
    due_date: form.due_date || null,
    payment_terms_days: form.payment_terms_days ? Number(form.payment_terms_days) : null,
    notes: form.notes,
    lines: form.lines.map(({ item_id, order_line_id, sku, description, qty, unit_price, tax_rate, discount_pct }) => ({
      item_id: item_id || null,
      order_line_id: order_line_id || null,
      sku,
      description,
      qty: qty || '0',
      unit_price: unit_price || '0',
      tax_rate: tax_rate || '0',
      discount_pct: discount_pct || '0',
    })),
  });

  const run = useMutation({
    mutationFn: (fn: () => Promise<PurchasingDoc>) => fn(),
    onSuccess: (d) => {
      void invalidate();
      setDirty(false);
      const k = isOrder && !d.kind ? 'orders' : docKind(d);
      if (isNew || k !== kind || d.id !== doc?.id) navigate(`/purchasing/${k}/${d.id}`, { replace: isNew });
    },
    onError: (e) => addToast({ type: 'error', title: getErrorMessage(e) }),
  });
  const persist = async (): Promise<PurchasingDoc> =>
    isNew ? purchasingApi.create(kind, body()) : dirty ? purchasingApi.update(kind, doc!.id, body()) : doc!;
  const guarded = (fn: () => void) => {
    setShowErrors(true);
    if (!valid) {
      addToast({ type: 'warning', title: t('purchasing.fix_errors', { defaultValue: 'Fix the highlighted fields first' }) });
      return;
    }
    fn();
  };
  const save = () => guarded(() => run.mutate(persist));
  const postDoc = () =>
    guarded(() =>
      run.mutate(async () => {
        const d = await persist();
        return isOrder ? purchasingApi.setOrderStatus(d.id, 'confirmed') : purchasingApi.post(kind, d.id);
      }),
    );

  const [pdfOpen, setPdfOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | { title: string; message: string; label: string; fn: () => Promise<unknown> }>(null);
  const duplicate = useDuplicateDoc();

  const receivable = isOrder && !!doc && ['confirmed', 'partially_received'].includes(doc.status);
  const billable = isOrder && !!doc && ['confirmed', 'partially_received', 'received'].includes(doc.status) && doc.lines.some((l) => Number(l.qty_billed ?? 0) < Number(l.qty));
  const paid = Number(doc?.amount_paid ?? 0);
  const canPay = !!doc && kind === 'bills' && ['posted', 'partially_paid'].includes(doc.status) && Number(doc.gross_total) - paid > 0;

  const more: MoreAction[] = [];
  if (doc) {
    const m = (key: string, label: string, onClick: () => void, danger = false) => more.push({ key, label: t(`purchasing.action_${key}`, { defaultValue: label }), onClick, danger });
    m('duplicate', 'Duplicate', () => duplicate.mutate({ kind, id: doc.id }, { onSuccess: (n) => navigate(`/purchasing/${kind}/${n.id}`) }));
    if (receivable) m('receive', 'Receive goods', () => setReceiveOpen(true));
    if (billable) m('bill', 'Create bill', () => run.mutate(() => purchasingApi.billFromOrder(doc.id)));
    if (canPay) m('pay', 'Record payment', () => setPayOpen(true));
    if (isOrder && ['partially_received', 'received'].includes(doc.status)) m('close', 'Close order', () => run.mutate(() => purchasingApi.setOrderStatus(doc.id, 'closed')));
    const cancellable = isOrder ? ['draft', 'confirmed'].includes(doc.status) : doc.status === 'draft' || (doc.status === 'posted' && paid === 0);
    if (cancellable)
      m('cancel', 'Cancel document', () =>
        setConfirm({
          title: t('purchasing.cancel_title', { defaultValue: 'Cancel {{number}}?', number: doc.number }),
          message: t('purchasing.cancel_msg', { defaultValue: 'The document stays on record as cancelled. Ledger postings are reversed.' }),
          label: t('purchasing.action_cancel', { defaultValue: 'Cancel document' }),
          fn: () => (isOrder ? purchasingApi.setOrderStatus(doc.id, 'cancelled') : purchasingApi.cancel(kind, doc.id)),
        }),
      true);
    if (doc.status === 'draft')
      m('delete', 'Delete draft', () =>
        setConfirm({
          title: t('purchasing.delete_title', { defaultValue: 'Delete {{number}}?', number: doc.number }),
          message: t('purchasing.delete_msg', { defaultValue: 'This draft will be removed permanently.' }),
          label: t('common.delete', { defaultValue: 'Delete' }),
          fn: async () => {
            await purchasingApi.remove(kind, doc.id);
            setDirty(false);
            navigate(`/purchasing?tab=${isOrder ? 'orders' : 'bills'}`);
          },
        }),
      true);
  }

  const timeline = buildTimeline({
    kind,
    status: doc?.status ?? 'draft',
    receivedPct: doc?.received_pct != null ? Number(doc.received_pct) : undefined,
    billCount: related.data?.kind === 'order' ? related.data.order.derived.bills.length : undefined,
    hasOrder: !!(doc?.order_id || (related.data?.kind === 'bill' && related.data.bill.source?.order)),
    hasReceipt: !!(doc?.receipt_id || (related.data?.kind === 'bill' && related.data.bill.source?.receipt)),
    balanceDue: doc ? Number(doc.balance_due ?? Number(doc.gross_total) - paid) : undefined,
    gross: doc ? Number(doc.gross_total) : undefined,
  });

  const title = doc?.number ?? t(`purchasing.new_${kind.replace('-', '_')}`, { defaultValue: NEW_LABEL[kind] });
  const cur = form.currency || 'EUR';
  const primaryLabel = isOrder ? t('purchasing.action_issue', { defaultValue: 'Issue order' }) : t('purchasing.action_post', { defaultValue: 'Post' });

  if (loadError) return <p className="p-6 text-sm text-semantic-error">{getErrorMessage(loadError)}</p>;

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: t('purchasing.title', { defaultValue: 'Purchasing' }), to: `/purchasing?tab=${isOrder ? 'orders' : 'bills'}` }, { label: title }]} />
      <PageHeader
        srTitle={t('purchasing.title', { defaultValue: 'Purchasing' })}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-3">
            <span className="text-lg font-semibold text-content-primary">{title}</span>
            {doc && <StatusBadge status={doc.status} />}
            {doc && kind === 'bills' && <MatchChip status={doc.match_status} />}
            {doc?.is_overdue && <span className="text-xs font-medium text-semantic-error">{t('purchasing.overdue', { defaultValue: 'overdue' })}</span>}
          </span>
        }
        actions={doc ? <StatusTimeline steps={timeline} /> : undefined}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Section title={t('purchasing.details', { defaultValue: 'Details' })}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs text-content-tertiary">
                {t('purchasing.date', { defaultValue: 'Date' })}
                <input type="date" className={inputCls} disabled={!editable} value={form.doc_date}
                  onChange={(e) => update({ doc_date: e.target.value, ...(form.payment_terms_days ? { due_date: addDays(e.target.value, Number(form.payment_terms_days)) } : {}) })} />
              </label>
              <label className="text-xs text-content-tertiary">
                {t('purchasing.terms', { defaultValue: 'Payment terms (days)' })}
                <input className={inputCls} inputMode="numeric" disabled={!editable} value={form.payment_terms_days}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '');
                    update({ payment_terms_days: v, ...(v && form.doc_date ? { due_date: addDays(form.doc_date, Number(v)) } : {}) });
                  }} />
              </label>
              <label className="text-xs text-content-tertiary">
                {isOrder ? t('purchasing.expected_date', { defaultValue: 'Expected delivery' }) : t('purchasing.due_date', { defaultValue: 'Due date' })}
                <input type="date" className={`${inputCls} ${showErrors && formErrors.due ? 'border-semantic-error' : ''}`} disabled={!editable} value={form.due_date} onChange={(e) => update({ due_date: e.target.value })} />
                {showErrors && formErrors.due && <span className="text-semantic-error">{formErrors.due}</span>}
              </label>
              <label className="text-xs text-content-tertiary">
                {t('purchasing.currency', { defaultValue: 'Currency' })}
                <input className={inputCls} maxLength={3} disabled={!editable} value={form.currency} onChange={(e) => update({ currency: e.target.value.toUpperCase() })} />
              </label>
              {!isOrder && (
                <label className="text-xs text-content-tertiary">
                  {t('purchasing.supplier_ref', { defaultValue: 'Supplier invoice no.' })}
                  <input className={inputCls} disabled={!editable} value={form.supplier_ref} onChange={(e) => update({ supplier_ref: e.target.value })} />
                </label>
              )}
            </div>
          </Section>

          <div className="space-y-2">
            <LineEditor
              lines={form.lines}
              editable={editable}
              currency={cur}
              baseTax={baseTax}
              showReceived={isOrder && !!doc && doc.status !== 'draft'}
              showMatch={kind === 'bills' && !!doc}
              errors={lineErrors}
              showErrors={showErrors}
              newLine={() => blankLine(baseTax)}
              onChange={(lines) => update({ lines })}
            />
            {showErrors && formErrors.lines && <p className="text-xs text-semantic-error">{formErrors.lines}</p>}
          </div>

          <Section title={t('purchasing.notes', { defaultValue: 'Notes' })}>
            <textarea className={`${inputCls} h-24 py-2`} disabled={!editable} value={form.notes}
              placeholder={t('purchasing.notes_ph', { defaultValue: 'Delivery instructions, terms, internal remarks…' })}
              onChange={(e) => update({ notes: e.target.value })} />
          </Section>

          {doc && <ActivityLog kind={kind} id={doc.id} />}
        </div>

        <aside className="space-y-5">
          <SupplierCard
            supplierId={form.supplier_id}
            supplierName={form.supplier_name}
            editable={editable}
            error={showErrors ? formErrors.supplier : undefined}
            onChange={(id, name, c) =>
              update({
                supplier_id: id,
                supplier_name: name,
                ...(c?.payment_terms_days && !form.payment_terms_days
                  ? { payment_terms_days: String(Number(c.payment_terms_days)), due_date: addDays(form.doc_date, Number(c.payment_terms_days)) }
                  : {}),
              })
            }
          />
          <DocTotals lines={form.lines} currency={cur} paid={paid} showBalance={!isOrder && !!doc && doc.status !== 'draft'} />
          {doc && kind !== 'orders' && doc.status !== 'draft' && <PaymentsCard doc={doc} canPay={canPay} onPay={() => setPayOpen(true)} />}
          {doc && <RelatedDocs kind={kind} id={doc.id} />}
        </aside>
      </div>

      <StickyActionBar
        dirty={dirty || isNew}
        busy={run.isPending}
        canSave={editable}
        primary={editable ? { label: primaryLabel, onClick: postDoc } : undefined}
        onPreview={doc ? () => setPdfOpen(true) : undefined}
        onSend={doc && isOrder && doc.status === 'draft' ? undefined : doc && isOrder && doc.status === 'confirmed' ? () =>
          run.mutate(async () => {
            await purchasingApi.bulk('orders', 'mark_sent', [doc.id]);
            addToast({ type: 'success', title: t('purchasing.marked_sent', { defaultValue: 'Marked as sent' }) });
            return purchasingApi.get('orders', doc.id);
          }) : undefined}
        more={more}
        onSave={save}
      />

      {doc && <PdfPreviewPanel kind={kind} id={doc.id} number={doc.number} open={pdfOpen} onClose={() => setPdfOpen(false)} />}
      <ReceiveDialog orderId={receiveOpen && doc ? doc.id : null} onClose={() => setReceiveOpen(false)} />
      <PaymentDialog bill={payOpen && doc ? doc : null} onClose={() => setPayOpen(false)} />
      <ConfirmDialog
        open={!!confirm}
        variant="danger"
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.label}
        loading={run.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c) c.fn().then(() => void invalidate()).catch((e) => addToast({ type: 'error', title: getErrorMessage(e) }));
        }}
      />
    </div>
  );
}
