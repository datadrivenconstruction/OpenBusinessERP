import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { WideModal } from '@/shared/ui/WideModal';
import { Button } from '@/shared/ui/Button';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { getErrorMessage } from '@/shared/lib/api';
import { purchasingApi, type PurchasingDocSummary } from '../api';
import { balanceDue } from '../helpers';
import { useInvalidatePurchasing } from '../hooks';
import { inputCls } from '../components/common';
import { fmtNumberForInput } from '@/shared/lib/formatters';
import { DateField } from '@/shared/ui/DateField';

export function PaymentDialog({ bill, onClose }: { bill: PurchasingDocSummary | null; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidatePurchasing();
  const open = bill ? balanceDue(bill) : 0;
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [reference, setReference] = useState('');
  useEffect(() => {
    if (!bill) return;
    setAmount(fmtNumberForInput(open));
    setDate(new Date().toISOString().slice(0, 10));
    setReference('');
  }, [bill, open]);
  const n = Number(amount);
  const err = !(n > 0) ? t('purchasing.pay_err_positive', { defaultValue: 'Enter an amount above zero' })
    : n > open + 0.005 ? t('purchasing.pay_err_over', { defaultValue: 'More than the open balance' }) : '';
  const m = useMutation({
    mutationFn: () => purchasingApi.pay(bill!.id, { amount, pay_date: date, reference }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  return (
    <WideModal
onSubmit={() => { if (!err && !m.isPending) m.mutate(); }}
      open={!!bill}
      onClose={onClose}
      busy={m.isPending}
      size="sm"
      title={t('purchasing.record_payment', { defaultValue: 'Record payment' })}
      subtitle={bill ? `${bill.number} · ${bill.supplier_name}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button variant="primary" loading={m.isPending} disabled={!!err} onClick={() => m.mutate()}>
            {t('purchasing.record_payment', { defaultValue: 'Record payment' })}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-content-secondary">
          {t('purchasing.open_amount', { defaultValue: 'Open' })}: <MoneyDisplay amount={open} currency={bill?.currency} className="font-semibold text-content-primary" />
        </p>
        <label className="block text-xs text-content-tertiary">
          {t('purchasing.pay_amount', { defaultValue: 'Amount' })}
          <input className={inputCls} inputMode="decimal" value={amount} aria-invalid={!!err} onChange={(e) => setAmount(e.target.value)} />
          {err && <span className="text-semantic-error">{err}</span>}
        </label>
        <label className="block text-xs text-content-tertiary">
          {t('purchasing.pay_date', { defaultValue: 'Payment date' })}
          <DateField className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block text-xs text-content-tertiary">
          {t('purchasing.pay_reference', { defaultValue: 'Reference' })}
          <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        {m.error && <p className="text-sm text-semantic-error">{getErrorMessage(m.error)}</p>}
      </div>
    </WideModal>
  );
}
