import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, MoneyDisplay, WideModal } from '@/shared/ui';
import { getErrorMessage } from '@/shared/lib/api';
import type { SalesDoc, SalesDocSummary } from '../api';
import { useRecordPayment } from '../hooks';
import { balanceDue } from '../lib/totals';
import { fmtNumberForInput } from '@/shared/lib/formatters';
import { DateField } from '@/shared/ui/DateField';

const input = 'w-full rounded-lg border border-border bg-surface-primary px-3 py-1.5 text-sm focus:border-oe-blue focus:outline-none';
const METHODS = ['bank_transfer', 'card', 'cash', 'other'] as const;

export function RecordPaymentModal({
  doc,
  onClose,
  onDone,
}: {
  doc: SalesDoc | SalesDocSummary;
  onClose: () => void;
  onDone?: (d: SalesDoc) => void;
}) {
  const { t } = useTranslation();
  const open = balanceDue(doc);
  const [amount, setAmount] = useState(fmtNumberForInput(open));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState<string>('bank_transfer');
  const pay = useRecordPayment();
  const n = Number(amount);
  const error = !(n > 0)
    ? t('sales.payment.err_positive', { defaultValue: 'Enter an amount above zero.' })
    : n > open + 0.005
      ? t('sales.payment.err_over', { defaultValue: 'Amount is more than the open balance.' })
      : null;
  const submit = () => {
    if (error || pay.isPending) return;
    pay.mutate(
      { id: doc.id, amount: n.toFixed(2), pay_date: date, reference, method },
      {
        onSuccess: (d) => {
          onDone?.(d);
          onClose();
        },
      },
    );
  };

  return (
    <WideModal
onSubmit={submit}
      open
      onClose={onClose}
      size="md"
      title={t('sales.record_payment', { defaultValue: 'Record payment' })}
      subtitle={
        <span>
          {doc.number} · {t('sales.open_amount', { defaultValue: 'Open' })} <MoneyDisplay amount={open} currency={doc.currency} />
        </span>
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            variant="primary"
            disabled={!!error}
            loading={pay.isPending}
            onClick={submit}
          >
            {t('sales.payment.save', { defaultValue: 'Record' })}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-content-tertiary">
          {t('sales.payment.amount', { defaultValue: 'Amount' })}
          <input className={input} inputMode="decimal" value={amount} aria-invalid={!!error} onChange={(e) => setAmount(e.target.value)} />
          {error && <span className="mt-0.5 block text-semantic-error">{error}</span>}
        </label>
        <label className="text-xs text-content-tertiary">
          {t('sales.payment.date', { defaultValue: 'Payment date' })}
          <DateField className={input} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-xs text-content-tertiary">
          {t('sales.payment.method', { defaultValue: 'Method' })}
          <select className={input} value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`sales.payment.method_${m}`, { defaultValue: m.replace('_', ' ') })}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-content-tertiary">
          {t('sales.payment.reference', { defaultValue: 'Reference' })}
          <input className={input} value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
      </div>
      {pay.error && <p className="mt-2 text-sm text-semantic-error">{getErrorMessage(pay.error)}</p>}
    </WideModal>
  );
}
