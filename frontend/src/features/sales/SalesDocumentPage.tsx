import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, FileMinus, Trash2, XCircle } from 'lucide-react';
import { apiGet, getErrorMessage } from '@/shared/lib/api';
import { Badge, Breadcrumb, ConfirmDialog, DateDisplay, MoneyDisplay } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { useToastStore } from '@/stores/useToastStore';
import { defaultTaxRate, taxRateOptions } from './taxDefaults';
import { SalesDocumentOutput, SendDialog } from './SalesDocumentOutput';
import { DOC_LANGUAGES, SALES_KINDS, STATUS_VARIANT, kindPath, salesApi, type SalesDoc, type SalesKind } from './api';
import { useDuplicate, useSalesActivity, useSalesDoc, useSalesRelated } from './hooks';
import { toBody, toForm, type FormErrors, type SalesForm } from './lib/form';
import { addDays, balanceDue, computeTotals, isOverdue, termsDays, validateLines } from './lib/totals';
import { docActions, type DocAction } from './lib/docActions';
import { StatusTimeline } from './components/StatusTimeline';
import { CustomerCard } from './components/CustomerCard';
import { LineEditor } from './components/LineEditor';
import { TotalsPanel } from './components/TotalsPanel';
import { ActivityCard, AttachmentsCard, PaymentsCard, RelatedDocsCard } from './components/DocSidePanels';
import { StickyActionBar } from './components/StickyActionBar';
import { PdfPreviewPanel } from './components/PdfPreviewPanel';
import type { ActionMenuItem } from './components/ActionMenu';
import { ConvertDialog } from './modals/ConvertDialog';
import { RecordPaymentModal } from './modals/RecordPaymentModal';

const input =
  'w-full rounded-lg border border-border-light bg-surface-primary px-2 py-1 text-sm text-content-primary focus:border-oe-blue focus:outline-none disabled:bg-surface-secondary aria-[invalid=true]:border-semantic-error';
const card = 'rounded-xl border border-border-light bg-surface-elevated p-4 shadow-xs';
const TERMS = ['', 'Due on receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 60'];

type Dialog = 'convert' | 'pay' | 'send' | 'pdf' | 'cancel' | 'delete' | null;

export function SalesDocumentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.addToast);
  const params = useParams<{ kind: string; id: string }>();
  const kind = (SALES_KINDS.includes(params.kind as SalesKind) ? params.kind : 'quotes') as SalesKind;
  const isNew = !params.id || params.id === 'new';
  const { data: doc, error: loadError } = useSalesDoc(kind, params.id);
  const activity = useSalesActivity(kind, params.id);
  const related = useSalesRelated(kind, params.id);
  const duplicate = useDuplicate(kind);
  const settings = useQuery({
    queryKey: ['business-settings'],
    queryFn: () => apiGet<{ base_currency?: string | null; country_code?: string | null }>('/v1/business-settings/'),
    retry: false,
  });
  const baseCur = settings.data?.base_currency || '';
  const countryTax = defaultTaxRate(settings.data?.country_code);
  const [form, setFormRaw] = useState<SalesForm>(toForm());
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [err, setErr] = useState<string | null>(null);
  const patch = (p: Partial<SalesForm>) => {
    setDirty(true);
    setFormRaw((f) => {
      const next = { ...f, ...p };
      // Terms drive the due date unless the user set one by hand in the same edit.
      if (('payment_terms' in p || 'doc_date' in p) && !('due_date' in p)) {
        const days = termsDays(next.payment_terms);
        if (days != null) next.due_date = addDays(next.doc_date, days);
        else if (/receipt/i.test(next.payment_terms)) next.due_date = next.doc_date;
      }
      return next;
    });
  };

  useEffect(() => {
    if (isNew && !dirty && settings.data) setFormRaw(toForm(undefined, baseCur || 'EUR', String(countryTax)));
  }, [isNew, dirty, settings.data, baseCur, countryTax]);
  useEffect(() => {
    if (doc) {
      setFormRaw(toForm(doc));
      setDirty(false);
      setShowErrors(false);
    }
  }, [doc]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  const leave = (to: string) => {
    if (dirty && !window.confirm(t('sales.unsaved_confirm', { defaultValue: 'Discard unsaved changes?' }))) return;
    setDirty(false);
    navigate(to);
  };

  const editable = isNew || doc?.status === 'draft';
  const totals = useMemo(() => computeTotals(form.lines), [form.lines]);
  const lineErrors = useMemo(() => validateLines(form.lines), [form.lines]);
  const errors: FormErrors = useMemo(() => {
    const e: FormErrors = {};
    if (!form.customer_id && !form.customer_name.trim()) e.customer = t('sales.validation.customer', { defaultValue: 'Choose a customer' });
    if (!/^[A-Za-z]{3}$/.test(form.currency)) e.currency = t('sales.validation.currency', { defaultValue: 'Use a 3-letter ISO code' });
    if (!form.doc_date) e.doc_date = t('sales.validation.date', { defaultValue: 'Date is required' });
    if (form.due_date && form.doc_date && form.due_date < form.doc_date)
      e.due_date = t('sales.validation.due_before', { defaultValue: 'Due date is before the document date' });
    if (!form.lines.length) e.lines = t('sales.validation.no_lines', { defaultValue: 'Add at least one line' });
    return e;
  }, [form, t]);
  const valid = !Object.keys(errors).length && !lineErrors.length;
  const visibleErrors = showErrors ? errors : {};

  const onDone = (d: SalesDoc) => {
    setErr(null);
    setDirty(false);
    qc.invalidateQueries({ queryKey: ['sales'] });
    navigate(`/sales/${kindPath(d.kind)}/${d.id}`, { replace: d.kind === doc?.kind || isNew });
  };
  const run = useMutation({
    mutationFn: (fn: () => Promise<SalesDoc>) => fn(),
    onSuccess: onDone,
    onError: (e) => setErr(getErrorMessage(e)),
  });
  const save = () => {
    setShowErrors(true);
    if (!valid) return;
    run.mutate(() => (isNew ? salesApi.create(kind, toBody(form)) : salesApi.update(kind, doc!.id, toBody(form))));
  };
  const removeDoc = useMutation({
    mutationFn: () => salesApi.remove(kind, doc!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      setDirty(false);
      navigate(`/sales?tab=${kind}`);
    },
    onError: (e) => setErr(getErrorMessage(e)),
  });

  const runAction = (a: DocAction) => {
    if (!doc) return;
    if (a.type === 'convert') return setDialog('convert');
    if (a.key === 'cancel') return setDialog('cancel');
    const fn =
      a.type === 'status'
        ? () => salesApi.setStatus(kind, doc.id, a.status)
        : a.type === 'issue'
          ? () => salesApi.issue(doc.id)
          : () => salesApi.creditNote(doc.id);
    run.mutate(fn);
  };
  const actions = doc ? docActions(doc.kind, doc.status) : [];
  const primaryAction = actions.find((a) => a.primary);
  const label = (a: DocAction) => t(`sales.action_${a.key}`, { defaultValue: a.label });
  const canPay = doc?.kind === 'invoice' && ['issued', 'partially_paid'].includes(doc.status) && balanceDue(doc) > 0;
  const more: ActionMenuItem[] = [
    ...actions.filter((a) => a !== primaryAction).map((a) => ({
      key: a.key,
      label: label(a),
      danger: a.danger,
      icon: a.key === 'cancel' ? <XCircle size={14} /> : a.type === 'credit_note' ? <FileMinus size={14} /> : undefined,
      onSelect: () => runAction(a),
    })),
    ...(doc
      ? [
          {
            key: 'dup',
            label: t('sales.action_duplicate', { defaultValue: 'Duplicate' }),
            icon: <Copy size={14} />,
            onSelect: () =>
              duplicate.mutate(doc.id, {
                onSuccess: (n) => leave(`/sales/${kindPath(n.kind)}/${n.id}`),
                onError: (e) => toast({ type: 'error', title: getErrorMessage(e) }),
              }),
          },
        ]
      : []),
    ...(doc?.status === 'draft'
      ? [{ key: 'delete', label: t('common.delete', { defaultValue: 'Delete' }), danger: true, icon: <Trash2 size={14} />, onSelect: () => setDialog('delete') }]
      : []),
  ];
  const cur = form.currency || baseCur || 'EUR';
  const title = doc?.number || t(`sales.new_${kind}`, { defaultValue: `New ${kind.slice(0, -1)}` });
  const overdue = doc ? isOverdue(doc) : false;
  const rates = useMemo(() => taxRateOptions(countryTax, form.lines.map((l) => l.tax_rate)), [countryTax, form.lines]);

  if (loadError && !isNew) {
    return (
      <div className="space-y-4">
        <Breadcrumb items={[{ label: t('sales.title', { defaultValue: 'Sales' }), to: `/sales?tab=${kind}` }, { label: '—' }]} />
        <p className="text-sm text-semantic-error">{getErrorMessage(loadError)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: t('sales.title', { defaultValue: 'Sales' }), to: `/sales?tab=${kind}` }, { label: title }]} />
      <PageHeader
        srTitle={t('sales.title', { defaultValue: 'Sales' })}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-content-primary">{title}</span>
            {doc && (
              <Badge variant={STATUS_VARIANT[doc.status] ?? 'neutral'} dot>
                {t(`sales.status_${doc.status}`, { defaultValue: doc.status.replace('_', ' ') })}
              </Badge>
            )}
            {overdue && <Badge variant="error">{t('sales.status_overdue', { defaultValue: 'overdue' })}</Badge>}
          </span>
        }
        actions={doc && <StatusTimeline kind={doc.kind} status={doc.status} />}
      />
      {err && (
        <div role="alert" className="rounded-lg border border-semantic-error/30 bg-semantic-error-bg px-3 py-2 text-sm text-semantic-error">
          {err}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <section className={`${card} grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
            <label className="text-xs text-content-tertiary">
              {t('sales.date', { defaultValue: 'Date' })}
              <input type="date" className={input} disabled={!editable} aria-invalid={!!visibleErrors.doc_date} value={form.doc_date} onChange={(e) => patch({ doc_date: e.target.value })} />
              {visibleErrors.doc_date && <span className="text-semantic-error">{visibleErrors.doc_date}</span>}
            </label>
            <label className="text-xs text-content-tertiary">
              {t('sales.payment_terms', { defaultValue: 'Payment terms' })}
              <select className={input} disabled={!editable} value={TERMS.includes(form.payment_terms) ? form.payment_terms : ''} onChange={(e) => patch({ payment_terms: e.target.value })}>
                {TERMS.map((x) => (
                  <option key={x} value={x}>
                    {x ? t(`sales.terms.${x.replace(/\s+/g, '_').toLowerCase()}`, { defaultValue: x }) : t('sales.terms.none', { defaultValue: 'Custom' })}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-content-tertiary">
              {t('sales.due_date', { defaultValue: 'Due date' })}
              <input
                type="date"
                className={input}
                disabled={!editable}
                aria-invalid={!!visibleErrors.due_date}
                value={form.due_date}
                onChange={(e) => patch({ due_date: e.target.value })}
              />
              {(visibleErrors.due_date || (overdue && !editable)) && (
                <span className="text-semantic-error">{visibleErrors.due_date ?? t('sales.status_overdue', { defaultValue: 'overdue' })}</span>
              )}
            </label>
            <label className="text-xs text-content-tertiary">
              {t('sales.currency', { defaultValue: 'Currency' })}
              <input className={input} maxLength={3} disabled={!editable} aria-invalid={!!visibleErrors.currency} value={form.currency} onChange={(e) => patch({ currency: e.target.value.toUpperCase(), fx_rate: '' })} />
              {visibleErrors.currency && <span className="text-semantic-error">{visibleErrors.currency}</span>}
            </label>
            {baseCur && form.currency && form.currency !== baseCur && (
              <label className="text-xs text-content-tertiary">
                {t('sales.fx_rate', { defaultValue: 'Rate (1 {{cur}} = ? {{base}})', cur: form.currency, base: baseCur })}
                <input
                  className={input}
                  inputMode="decimal"
                  disabled={!editable}
                  placeholder={t('sales.fx_rate_auto', { defaultValue: 'Automatic (rate on document date)' })}
                  value={form.fx_rate}
                  onChange={(e) => patch({ fx_rate: e.target.value.replace(',', '.') })}
                />
              </label>
            )}
            <label className="text-xs text-content-tertiary">
              {t('sales.document_language', { defaultValue: 'Document language' })}
              <select className={input} disabled={!editable} value={form.language} onChange={(e) => patch({ language: e.target.value })}>
                <option value="">{t('sales.language_default', { defaultValue: 'Default (English)' })}</option>
                {DOC_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-content-tertiary">
              {t('sales.delivery_date', { defaultValue: 'Delivery date / period start' })}
              <input type="date" className={input} disabled={!editable} value={form.delivery_date} onChange={(e) => patch({ delivery_date: e.target.value })} />
            </label>
            <label className="text-xs text-content-tertiary">
              {t('sales.delivery_end', { defaultValue: 'Period end (optional)' })}
              <input type="date" className={input} disabled={!editable} value={form.delivery_end} onChange={(e) => patch({ delivery_end: e.target.value })} />
            </label>
          </section>

          <section className="overflow-hidden rounded-xl border border-border-light bg-surface-elevated shadow-xs">
            <LineEditor
              lines={form.lines}
              onChange={(lines) => patch({ lines })}
              editable={editable}
              currency={cur}
              taxRates={rates}
              defaultTax={String(countryTax)}
              errors={showErrors ? lineErrors : []}
            />
            {visibleErrors.lines && <p className="px-3 pb-2 text-xs text-semantic-error">{visibleErrors.lines}</p>}
          </section>

          <section className={`${card} grid grid-cols-1 gap-3 md:grid-cols-2`}>
            <label className="text-xs text-content-tertiary">
              {t('sales.notes', { defaultValue: 'Notes' })}
              <textarea className={`${input} min-h-[88px]`} disabled={!editable} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} />
            </label>
            <label className="text-xs text-content-tertiary">
              {t('sales.tax_note', { defaultValue: 'Tax note (exemption / reverse charge)' })}
              <textarea className={`${input} min-h-[88px]`} disabled={!editable} value={form.tax_note} onChange={(e) => patch({ tax_note: e.target.value })} />
            </label>
          </section>

          {doc && <SalesDocumentOutput doc={doc} />}
        </div>

        <aside className="space-y-4">
          <CustomerCard form={form} set={patch} editable={editable} error={visibleErrors.customer} />
          <TotalsPanel
            totals={totals}
            currency={cur}
            paid={doc ? Number(doc.amount_paid) : 0}
            showBalance={doc?.kind === 'invoice' && doc.status !== 'draft'}
            base={baseCur && cur !== baseCur ? { currency: baseCur, rate: Number(form.fx_rate || doc?.fx_rate || 0) } : undefined}
          />
          {doc?.due_date && !editable && (
            <p className="px-1 text-xs text-content-tertiary">
              {t('sales.due_date', { defaultValue: 'Due date' })}: <DateDisplay value={doc.due_date} />
              {doc.kind === 'invoice' && (
                <>
                  {' · '}
                  <MoneyDisplay amount={balanceDue(doc)} currency={doc.currency} />
                </>
              )}
            </p>
          )}
          {doc?.kind === 'invoice' && doc.status !== 'draft' && <PaymentsCard doc={doc} onRecord={canPay ? () => setDialog('pay') : undefined} />}
          <RelatedDocsCard related={related.data} />
          {doc && <ActivityCard entries={activity.data} loading={activity.isLoading} />}
          <AttachmentsCard />
        </aside>
      </div>

      <StickyActionBar
        dirty={dirty}
        editable={editable}
        busy={run.isPending}
        canSave={!showErrors || valid}
        primary={primaryAction && { label: label(primaryAction), onClick: () => runAction(primaryAction) }}
        onSave={save}
        onPreview={doc ? () => setDialog('pdf') : undefined}
        onSend={doc ? () => setDialog('send') : undefined}
        more={more}
      />

      {doc && (
        <PdfPreviewPanel kind={kind} id={doc.id} filename={`${doc.kind}-${doc.number}.pdf`} open={dialog === 'pdf'} onClose={() => setDialog(null)} />
      )}
      {doc && dialog === 'send' && <SendDialog doc={doc} onClose={() => setDialog(null)} />}
      {doc && dialog === 'convert' && <ConvertDialog doc={doc} onClose={() => setDialog(null)} onDone={onDone} />}
      {doc && dialog === 'pay' && <RecordPaymentModal doc={doc} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === 'cancel'}
        variant="warning"
        loading={run.isPending}
        title={t('sales.cancel_title', { defaultValue: 'Cancel this document?' })}
        message={t('sales.cancel_msg', { defaultValue: 'A cancelled document stays on record but can no longer be changed or converted.' })}
        confirmLabel={t('sales.action_cancel', { defaultValue: 'Cancel document' })}
        onConfirm={() => {
          setDialog(null);
          if (doc) run.mutate(() => salesApi.setStatus(kind, doc.id, 'cancelled'));
        }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        variant="danger"
        loading={removeDoc.isPending}
        title={t('sales.delete_title', { defaultValue: 'Delete this draft?' })}
        message={t('sales.delete_msg', { defaultValue: 'The draft and its lines are removed. This cannot be undone.' })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        onConfirm={() => removeDoc.mutate()}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
