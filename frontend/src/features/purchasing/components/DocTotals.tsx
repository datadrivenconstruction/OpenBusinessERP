import { useTranslation } from 'react-i18next';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import type { PurchasingLine } from '../api';
import { totalsByTaxRate } from '../helpers';
import { Section } from './common';

export function DocTotals({ lines, currency, paid, showBalance, base }: { lines: PurchasingLine[]; currency: string; paid?: number; showBalance?: boolean; base?: { currency: string; rate: number } }) {
  const { t } = useTranslation();
  const tt = totalsByTaxRate(lines);
  const row = 'flex justify-between py-0.5 text-content-secondary';
  return (
    <Section title={t('purchasing.totals', { defaultValue: 'Totals' })}>
      <dl className="text-sm">
        <div className={row}>
          <dt>{t('purchasing.total_net', { defaultValue: 'Net' })}</dt>
          <dd className="tabular-nums"><MoneyDisplay amount={tt.net} currency={currency} /></dd>
        </div>
        {tt.buckets.map((b) => (
          <div key={b.rate} className={row}>
            <dt>
              {t('purchasing.tax_at', { defaultValue: 'Tax {{rate}}% on', rate: b.rate })} <MoneyDisplay amount={b.net} currency={currency} />
            </dt>
            <dd className="tabular-nums"><MoneyDisplay amount={b.tax} currency={currency} /></dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t border-border-light pt-1.5 text-base font-semibold text-content-primary">
          <dt>{t('purchasing.total_gross', { defaultValue: 'Total' })}</dt>
          <dd className="tabular-nums"><MoneyDisplay amount={tt.gross} currency={currency} /></dd>
        </div>
        {base && base.rate > 0 && (
          <div className="flex justify-between py-0.5 text-xs text-content-tertiary">
            <dt>{t('sales.totals.in_base', { defaultValue: 'In {{base}} at {{rate}}', base: base.currency, rate: base.rate })}</dt>
            <dd className="tabular-nums"><MoneyDisplay amount={Math.round(tt.gross * base.rate * 100) / 100} currency={base.currency} /></dd>
          </div>
        )}
        {showBalance && (
          <>
            <div className={row}>
              <dt>{t('purchasing.paid', { defaultValue: 'Paid' })}</dt>
              <dd className="tabular-nums"><MoneyDisplay amount={paid ?? 0} currency={currency} /></dd>
            </div>
            <div className="flex justify-between py-0.5 font-medium text-content-primary">
              <dt>{t('purchasing.col_balance', { defaultValue: 'Balance due' })}</dt>
              <dd className="tabular-nums"><MoneyDisplay amount={Math.round((tt.gross - (paid ?? 0)) * 100) / 100} currency={currency} /></dd>
            </div>
          </>
        )}
      </dl>
    </Section>
  );
}
