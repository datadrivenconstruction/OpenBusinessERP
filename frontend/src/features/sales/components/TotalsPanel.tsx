import { useTranslation } from 'react-i18next';
import { MoneyDisplay } from '@/shared/ui';
import type { DocTotals } from '../lib/totals';
import { fmtFixed } from '@/shared/lib/formatters';

export function TotalsPanel({
  totals,
  currency,
  paid,
  showBalance,
  base,
}: {
  totals: DocTotals;
  currency: string;
  paid?: number;
  showBalance?: boolean;
  /** Foreign document: base currency and rate (base units per document unit); 0 = not yet known. */
  base?: { currency: string; rate: number };
}) {
  const { t } = useTranslation();
  const row = 'flex justify-between py-0.5';
  return (
    <section className="rounded-xl border border-border-light bg-surface-elevated p-4 text-sm shadow-xs">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-tertiary">
        {t('sales.totals.title', { defaultValue: 'Totals' })}
      </h2>
      <dl>
        {totals.discount > 0 && (
          <div className={`${row} text-content-tertiary`}>
            <dt>{t('sales.totals.discount', { defaultValue: 'Discounts' })}</dt>
            <dd className="tabular-nums">
              <MoneyDisplay amount={-totals.discount} currency={currency} />
            </dd>
          </div>
        )}
        <div className={`${row} text-content-secondary`}>
          <dt>{t('sales.total_net', { defaultValue: 'Net' })}</dt>
          <dd className="tabular-nums">
            <MoneyDisplay amount={totals.net} currency={currency} />
          </dd>
        </div>
        {totals.groups.map((g) => (
          <div key={g.rate} className={`${row} text-content-secondary`}>
            <dt>
              {t('sales.totals.tax_at', { defaultValue: 'Tax {{rate}} % on {{base}}', rate: g.rate, base: fmtFixed(g.net) })}
            </dt>
            <dd className="tabular-nums">
              <MoneyDisplay amount={g.tax} currency={currency} />
            </dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t border-border-light pt-1.5 text-base font-semibold text-content-primary">
          <dt>{t('sales.total_gross', { defaultValue: 'Total' })}</dt>
          <dd className="tabular-nums">
            <MoneyDisplay amount={totals.gross} currency={currency} />
          </dd>
        </div>
        {base && base.rate > 0 && (
          <div className={`${row} text-xs text-content-tertiary`}>
            <dt>
              {t('sales.totals.in_base', { defaultValue: 'In {{base}} at {{rate}}', base: base.currency, rate: base.rate })}
            </dt>
            <dd className="tabular-nums">
              <MoneyDisplay amount={Math.round(totals.gross * base.rate * 100) / 100} currency={base.currency} />
            </dd>
          </div>
        )}
        {showBalance && (
          <>
            <div className={`${row} text-content-secondary`}>
              <dt>{t('sales.totals.paid', { defaultValue: 'Paid' })}</dt>
              <dd className="tabular-nums">
                <MoneyDisplay amount={paid ?? 0} currency={currency} />
              </dd>
            </div>
            <div className={`${row} font-medium text-content-primary`}>
              <dt>{t('sales.col_balance', { defaultValue: 'Balance due' })}</dt>
              <dd className="tabular-nums">
                <MoneyDisplay amount={totals.gross - (paid ?? 0)} currency={currency} />
              </dd>
            </div>
          </>
        )}
      </dl>
    </section>
  );
}
