import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, MoneyDisplay } from '@/shared/ui';
import { getErrorMessage } from '@/shared/lib/api';
import { glApi, type FxRevalResult } from './api';
import { inputCls, numCls, thCls } from './ui';

/** Period-end revaluation of open foreign-currency receivables and payables. */
export function FxRevaluationPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const years = useQuery({ queryKey: ['gl', 'fiscal-years'], queryFn: glApi.fiscalYears, retry: false });
  const periods = (years.data ?? []).flatMap((y) => y.periods);
  const [periodEnd, setPeriodEnd] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [result, setResult] = useState<FxRevalResult | null>(null);

  const body = () => {
    const rates: Record<string, string> = {};
    for (const [c, v] of Object.entries(overrides)) if (Number(v) > 0) rates[c] = v;
    return { period_end: periodEnd, ...(Object.keys(rates).length ? { rates } : {}) };
  };
  const preview = useMutation({ mutationFn: () => glApi.fxRevalPreview(body()), onSuccess: setResult });
  const post = useMutation({
    mutationFn: () => glApi.fxRevalPost(body()),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['gl'] });
    },
  });
  const error = preview.error ?? post.error;
  const base = result?.base_currency ?? '';
  const currencies = result ? Object.keys(result.rates) : [];
  const th = `${thCls} text-right`;

  return (
    <section className="mt-6 rounded-md border border-border-light bg-surface-primary p-4">
      <h2 className="text-sm font-semibold text-content-primary">{t('accounting.fx_reval_title', { defaultValue: 'FX revaluation' })}</h2>
      <p className="mt-1 text-xs text-content-secondary">
        {t('accounting.fx_reval_hint', { defaultValue: 'Revalues open foreign-currency receivables and payables at the closing rate. The entry reverses automatically on the first day of the next period.' })}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-content-tertiary">
          {t('accounting.fx_reval_period', { defaultValue: 'Period' })}
          <select className={inputCls} value="" onChange={(e) => e.target.value && setPeriodEnd(e.target.value)}>
            <option value="">{t('accounting.fx_reval_pick_period', { defaultValue: 'Pick a period…' })}</option>
            {periods.map((p) => (
              <option key={p.id} value={p.end_date}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-content-tertiary">
          {t('accounting.fx_reval_date', { defaultValue: 'Closing date' })}
          <input type="date" className={inputCls} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </label>
        {currencies.map((c) => (
          <label key={c} className="text-xs text-content-tertiary">
            {t('accounting.fx_reval_rate', { defaultValue: 'Closing rate {{cur}}', cur: c })}
            <input
              className={inputCls}
              inputMode="decimal"
              placeholder={result?.rates[c]}
              value={overrides[c] ?? ''}
              onChange={(e) => setOverrides((o) => ({ ...o, [c]: e.target.value.replace(',', '.') }))}
            />
          </label>
        ))}
        <Button variant="secondary" disabled={!periodEnd || preview.isPending} onClick={() => preview.mutate()}>
          {t('accounting.fx_reval_preview', { defaultValue: 'Preview' })}
        </Button>
        <Button disabled={!result || result.posted || result.rows.length === 0 || post.isPending} onClick={() => post.mutate()}>
          {t('accounting.fx_reval_post', { defaultValue: 'Post revaluation' })}
        </Button>
      </div>
      {error != null && <p className="mt-2 text-xs text-semantic-error">{getErrorMessage(error)}</p>}
      {result && (
        <div className="mt-4">
          <p className={`mb-2 text-xs ${result.posted ? 'text-semantic-success' : 'text-content-tertiary'}`}>
            {result.posted
              ? t('accounting.fx_reval_posted', { defaultValue: 'Posted. Reverses automatically on {{date}}.', date: result.reversal_date })
              : t('accounting.fx_reval_reverses', { defaultValue: 'Reverses automatically on {{date}}.', date: result.reversal_date })}
          </p>
          {result.rows.length === 0 ? (
            <p className="text-sm text-content-tertiary">{t('accounting.fx_reval_none', { defaultValue: 'No open foreign-currency documents.' })}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-content-tertiary">
                  <tr>
                    <th className={thCls}>{t('accounting.fx_reval_col_doc', { defaultValue: 'Document' })}</th>
                    <th className={thCls}>{t('accounting.fx_reval_col_party', { defaultValue: 'Party' })}</th>
                    <th className={th}>{t('accounting.fx_reval_col_open', { defaultValue: 'Open' })}</th>
                    <th className={th}>{t('accounting.fx_reval_col_doc_rate', { defaultValue: 'Doc rate' })}</th>
                    <th className={th}>{t('accounting.fx_reval_col_closing', { defaultValue: 'Closing rate' })}</th>
                    <th className={th}>{t('accounting.fx_reval_col_booked', { defaultValue: 'Booked' })}</th>
                    <th className={th}>{t('accounting.fx_reval_col_revalued', { defaultValue: 'Revalued' })}</th>
                    <th className={th}>{t('accounting.fx_reval_col_gain', { defaultValue: 'Gain / loss' })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {result.rows.map((r) => (
                    <tr key={`${r.side}-${r.id}`}>
                      <td className="px-4 py-2">{r.number}</td>
                      <td className="px-4 py-2">{r.party}</td>
                      <td className={numCls}><MoneyDisplay amount={r.open} currency={r.currency} /></td>
                      <td className={numCls}>{Number(r.doc_rate).toFixed(4)}</td>
                      <td className={numCls}>{Number(r.closing_rate).toFixed(4)}</td>
                      <td className={numCls}><MoneyDisplay amount={r.booked} currency={base} /></td>
                      <td className={numCls}><MoneyDisplay amount={r.revalued} currency={base} /></td>
                      <td className={numCls}><MoneyDisplay amount={r.gain} currency={base} colorize /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <dl className="mt-3 flex flex-wrap gap-6 text-sm">
            <div>
              <dt className="text-xs text-content-tertiary">{t('accounting.fx_reval_receivable_diff', { defaultValue: 'Receivables' })}</dt>
              <dd className="tabular-nums"><MoneyDisplay amount={result.receivable_diff} currency={base} colorize /></dd>
            </div>
            <div>
              <dt className="text-xs text-content-tertiary">{t('accounting.fx_reval_payable_diff', { defaultValue: 'Payables' })}</dt>
              <dd className="tabular-nums"><MoneyDisplay amount={result.payable_diff} currency={base} colorize /></dd>
            </div>
            <div>
              <dt className="text-xs text-content-tertiary">{t('accounting.fx_reval_net', { defaultValue: 'Net gain / loss' })}</dt>
              <dd className="font-semibold tabular-nums"><MoneyDisplay amount={result.net_gain} currency={base} colorize /></dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
