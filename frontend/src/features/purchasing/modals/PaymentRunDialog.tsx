import { useTranslation } from 'react-i18next';
import { WideModal } from '@/shared/ui/WideModal';
import { Button } from '@/shared/ui/Button';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { DateDisplay } from '@/shared/ui/DateDisplay';
import type { PurchasingDocSummary } from '../api';
import { balanceDue, paymentRun } from '../helpers';

/** Read-only summary of what paying the selected bills would cost, per currency. */
export function PaymentRunDialog({ bills, open, onClose, onExport }: { bills: PurchasingDocSummary[]; open: boolean; onClose: () => void; onExport: () => void }) {
  const { t } = useTranslation();
  const groups = paymentRun(bills);
  const payable = bills.filter((b) => b.kind !== 'credit_note' && balanceDue(b) > 0);
  const skipped = bills.length - payable.length;
  return (
    <WideModal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('purchasing.payment_run_title', { defaultValue: 'Payment run' })}
      subtitle={t('purchasing.payment_run_sub', { defaultValue: '{{count}} bills with an open balance', count: payable.length })}
      footer={
        <>
          <Button variant="secondary" onClick={onExport}>{t('purchasing.bulk_export', { defaultValue: 'Export CSV' })}</Button>
          <Button variant="primary" onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</Button>
        </>
      }
    >
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.currency} className="rounded-lg border border-border-light p-3">
            <div className="text-xs text-content-tertiary">
              {t('purchasing.payment_run_group', { defaultValue: '{{count}} bills · {{suppliers}} suppliers', count: g.count, suppliers: g.suppliers })}
            </div>
            <MoneyDisplay amount={g.total} currency={g.currency} className="text-lg font-semibold" />
          </div>
        ))}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {payable.map((b) => (
            <tr key={b.id} className="border-t border-border-light">
              <td className="py-1.5 font-mono text-xs">{b.number}</td>
              <td className="py-1.5">{b.supplier_name}</td>
              <td className={`py-1.5 ${b.is_overdue ? 'text-semantic-error' : 'text-content-secondary'}`}>
                {b.due_date ? <DateDisplay value={b.due_date} /> : '—'}
              </td>
              <td className="py-1.5 text-right tabular-nums"><MoneyDisplay amount={balanceDue(b)} currency={b.currency} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {skipped > 0 && (
        <p className="mt-3 text-xs text-content-tertiary">
          {t('purchasing.payment_run_skipped', { defaultValue: '{{count}} selected documents have nothing to pay and were left out.', count: skipped })}
        </p>
      )}
    </WideModal>
  );
}
