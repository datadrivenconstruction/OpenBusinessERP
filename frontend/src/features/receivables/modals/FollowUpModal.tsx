/** Log a note or a payment promise for one customer. Purely a record; nothing is sent to the customer. */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Button } from '@/shared/ui/Button';
import { WideModal, WideModalField, WideModalSection } from '@/shared/ui';
import { getErrorMessage } from '@/shared/lib/api';
import { receivablesApi, type AgingInvoice, type FollowUpInput } from '../api';
import { inputCls, textareaCls } from '../components/shared';

interface Props {
  open: boolean;
  onClose: () => void;
  partnerKey: string;
  customerName: string;
  invoices: AgingInvoice[];
  kind: 'note' | 'promise';
}

/** Validation shared with the test: returns an i18n key per broken field. */
export function validateFollowUp(v: Pick<FollowUpInput, 'kind' | 'text' | 'promised_date' | 'promised_amount'>) {
  const errors: Record<string, string> = {};
  if (v.kind === 'note' && !(v.text ?? '').trim()) errors.text = 'receivables.err_note_text';
  if (v.kind === 'promise') {
    if (!v.promised_date) errors.promised_date = 'receivables.err_promise_date';
    const n = Number(String(v.promised_amount ?? '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) errors.promised_amount = 'receivables.err_promise_amount';
  }
  return errors;
}

export function FollowUpModal({ open, onClose, partnerKey, customerName, invoices, kind }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText('');
    setInvoiceId('');
    setDate('');
    setAmount('');
    setTouched(false);
    setServerError(null);
  }, [open, kind]);

  const pickInvoice = (id: string) => {
    setInvoiceId(id);
    const inv = invoices.find((i) => i.id === id);
    if (inv && !amount) setAmount(inv.open);
  };

  const values = { kind, text, promised_date: date || null, promised_amount: amount.replace(',', '.') || null };
  const errors = validateFollowUp(values);
  const save = useMutation({
    mutationFn: () =>
      receivablesApi.addFollowUp({ ...values, partner_key: partnerKey, customer_name: customerName, invoice_id: invoiceId || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['receivables'] });
      onClose();
    },
    onError: (e) => setServerError(getErrorMessage(e)),
  });
  const submit = () => {
    setTouched(true);
    if (Object.keys(errors).length === 0) save.mutate();
  };
  const err = (k: string) => (touched && errors[k] ? t(errors[k]!) : undefined);
  const title =
    kind === 'promise'
      ? t('receivables.promise_title', { defaultValue: 'Log a payment promise' })
      : t('receivables.note_title', { defaultValue: 'Add a note' });

  return (
    <WideModal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={customerName}
      size="md"
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button variant="primary" disabled={save.isPending} onClick={submit}>{t('common.save', { defaultValue: 'Save' })}</Button>
        </>
      }
    >
      <WideModalSection columns={2}>
        {kind === 'promise' && (
          <>
            <WideModalField label={t('receivables.promised_date', { defaultValue: 'Promised for' })} required error={err('promised_date')} htmlFor="ar-promise-date">
              <input id="ar-promise-date" type="date" className={clsx(inputCls, 'w-full')} value={date} onChange={(e) => setDate(e.target.value)} />
            </WideModalField>
            <WideModalField label={t('receivables.promised_amount', { defaultValue: 'Amount' })} required error={err('promised_amount')} htmlFor="ar-promise-amount">
              <input id="ar-promise-amount" inputMode="decimal" className={clsx(inputCls, 'w-full text-right tabular-nums')} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </WideModalField>
          </>
        )}
        <WideModalField
          label={t('receivables.for_invoice', { defaultValue: 'Invoice (optional)' })}
          span={2}
          htmlFor="ar-followup-invoice"
        >
          <select id="ar-followup-invoice" className={clsx(inputCls, 'w-full')} value={invoiceId} onChange={(e) => pickInvoice(e.target.value)}>
            <option value="">{t('receivables.whole_account', { defaultValue: 'Whole account' })}</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>{i.number} · {i.open} {i.currency}</option>
            ))}
          </select>
        </WideModalField>
        <WideModalField
          label={kind === 'promise' ? t('receivables.promise_note', { defaultValue: 'What was agreed' }) : t('receivables.note_text', { defaultValue: 'Note' })}
          required={kind === 'note'}
          error={err('text')}
          span={2}
          htmlFor="ar-followup-text"
        >
          <textarea id="ar-followup-text" className={clsx(textareaCls, 'h-28')} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
        </WideModalField>
      </WideModalSection>
      <p className="mt-3 text-xs text-content-tertiary">
        {t('receivables.followup_hint', { defaultValue: 'This is your own record. The customer is not contacted.' })}
      </p>
      {serverError && <p className="mt-2 text-sm text-semantic-error">{serverError}</p>}
    </WideModal>
  );
}
