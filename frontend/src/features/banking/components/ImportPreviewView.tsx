import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AlertTriangle, Copy, FilePlus2, Wand2 } from 'lucide-react';
import { Badge, DateDisplay, MoneyDisplay } from '@/shared/ui';
import type { ImportPreview, PreviewState } from '../api';
import { fmtList } from '@/shared/lib/formatters';

const STATE_VARIANT = { new: 'success', duplicate: 'neutral', duplicate_in_file: 'warning' } as const;
const STATE_LABEL: Record<PreviewState, string> = { new: 'New', duplicate: 'Already imported', duplicate_in_file: 'Twice in file' };

export function ImportPreviewView({ preview: p, currency }: { preview: ImportPreview; currency: string }) {
  const { t } = useTranslation();
  const [onlyNew, setOnlyNew] = useState(false);
  const rows = onlyNew ? p.rows.filter((r) => r.state === 'new') : p.rows;
  const ruleHits = p.rows.filter((r) => r.state === 'new' && r.rule_name).length;
  const stat = (label: string, value: React.ReactNode, tone?: string) => (
    <div className="rounded-lg border border-border-light px-3 py-2">
      <div className="text-xs text-content-tertiary">{label}</div>
      <div className={clsx('text-base font-semibold tabular-nums', tone ?? 'text-content-primary')}>{value}</div>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat(t('banking.pv_new', { defaultValue: 'New lines' }), p.new_count, 'text-semantic-success')}
        {stat(t('banking.pv_dupes', { defaultValue: 'Already imported' }), p.duplicate_count, p.duplicate_count ? 'text-content-secondary' : undefined)}
        {stat(t('banking.pv_in', { defaultValue: 'Money in' }), <MoneyDisplay amount={p.total_in} currency={currency} />)}
        {stat(t('banking.pv_out', { defaultValue: 'Money out' }), <MoneyDisplay amount={p.total_out} currency={currency} colorize />)}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-content-secondary">
        <span>{t('banking.pv_format', { defaultValue: 'Format' })}: <strong>{p.format}</strong></span>
        {p.date_from && (
          <span>
            {t('banking.pv_period', { defaultValue: 'Period' })}: <DateDisplay value={p.date_from} /> – <DateDisplay value={p.date_to} />
          </span>
        )}
        {ruleHits > 0 && (
          <span className="flex items-center gap-1 text-oe-blue-text">
            <Wand2 size={12} />
            {t('banking.pv_rule_hits', { defaultValue: '{{n}} new lines match a rule', n: ruleHits })}
          </span>
        )}
      </div>
      {p.duplicate_in_file_count > 0 && (
        <p className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          <Copy size={14} />
          {t('banking.pv_dupes_in_file', { defaultValue: '{{n}} lines appear twice in this file and will be imported once.', n: p.duplicate_in_file_count })}
        </p>
      )}
      {p.currency_mismatch && (
        <p className="flex items-center gap-1.5 rounded-lg bg-semantic-error/10 px-3 py-2 text-sm text-semantic-error">
          <AlertTriangle size={14} />
          {t('banking.pv_currency', { defaultValue: 'The file contains {{list}} while the account is in {{ccy}}. Check you picked the right account.', list: fmtList(p.currencies), ccy: currency })}
        </p>
      )}
      {p.new_count === 0 && p.total > 0 && (
        <p className="flex items-center gap-1.5 rounded-lg bg-surface-secondary px-3 py-2 text-sm text-content-secondary">
          <FilePlus2 size={14} />
          {t('banking.pv_nothing_new', { defaultValue: 'Every line in this file is already imported. Nothing would change.' })}
        </p>
      )}
      <label className="flex items-center gap-1.5 text-xs text-content-secondary">
        <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
        {t('banking.pv_only_new', { defaultValue: 'Show new lines only' })}
      </label>
      <div className="max-h-[45vh] overflow-auto rounded-lg border border-border-light">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-secondary text-xs text-content-tertiary">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">{t('banking.booking_date', { defaultValue: 'Booked' })}</th>
              <th className="px-3 py-1.5 text-left font-medium">{t('banking.map_counterparty_name', { defaultValue: 'Counterparty' })}</th>
              <th className="px-3 py-1.5 text-left font-medium">{t('banking.map_remittance', { defaultValue: 'Payment text' })}</th>
              <th className="px-3 py-1.5 text-right font-medium">{t('banking.amount', { defaultValue: 'Amount' })}</th>
              <th className="px-3 py-1.5 text-left font-medium">{t('banking.pv_state', { defaultValue: 'Status' })}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={clsx('border-t border-border-light', r.state !== 'new' && 'opacity-60')}>
                <td className="whitespace-nowrap px-3 py-1.5"><DateDisplay value={r.booking_date} /></td>
                <td className="max-w-[12rem] truncate px-3 py-1.5">{r.counterparty_name || '—'}</td>
                <td className="max-w-[18rem] truncate px-3 py-1.5 text-content-secondary">{r.remittance || r.reference || '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right"><MoneyDisplay amount={r.amount} currency={r.currency} colorize /></td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <Badge size="sm" variant={STATE_VARIANT[r.state]}>{t(`banking.pv_state_${r.state}`, { defaultValue: STATE_LABEL[r.state] })}</Badge>
                  {r.rule_name && r.state === 'new' && <span className="ml-1 text-[11px] text-oe-blue-text">{r.rule_name}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.total > p.rows.length && (
        <p className="text-xs text-content-tertiary">
          {t('banking.pv_truncated', { defaultValue: 'Showing the first {{n}} of {{total}} lines.', n: p.rows.length, total: p.total })}
        </p>
      )}
    </div>
  );
}
