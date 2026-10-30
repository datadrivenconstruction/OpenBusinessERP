import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { CsvMapping } from '../api';
import { inputCls } from '../modals/AccountFormModal';

export const MAP_FIELDS: Array<keyof CsvMapping> = [
  'date', 'value_date', 'amount', 'debit', 'credit', 'currency', 'counterparty_name', 'counterparty_iban', 'remittance', 'reference',
];

const LABELS: Record<string, string> = {
  date: 'Booking date', value_date: 'Value date', amount: 'Amount (signed)', debit: 'Debit (money out)', credit: 'Credit (money in)',
  currency: 'Currency', counterparty_name: 'Counterparty', counterparty_iban: 'Counterparty IBAN', remittance: 'Payment text', reference: 'Bank reference',
};

interface Props {
  headers: string[];
  sample: string[][];
  mapping: CsvMapping;
  onChange: (m: CsvMapping) => void;
}

/** Column mapping with the file's first rows underneath, so the user sees which column feeds which field. */
export function ImportMapping({ headers, sample, mapping, onChange }: Props) {
  const { t } = useTranslation();
  const used = new Map<string, string>();
  for (const f of MAP_FIELDS) if (mapping[f]) used.set(mapping[f] as string, f);
  return (
    <div className="space-y-4">
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {MAP_FIELDS.map((f) => (
          <label key={f} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-content-secondary">
              {t(`banking.map_${f}`, { defaultValue: LABELS[f] })}
              {f === 'date' && <span className="text-rose-500"> *</span>}
            </span>
            <select className={clsx(inputCls, 'max-w-[220px]')} value={(mapping[f] as string) ?? ''} onChange={(e) => onChange({ ...mapping, [f]: e.target.value })}>
              <option value="">—</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
        ))}
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-content-secondary">{t('banking.map_decimal', { defaultValue: 'Decimal separator' })}</span>
          <select className={clsx(inputCls, 'max-w-[220px]')} value={mapping.decimal ?? ''} onChange={(e) => onChange({ ...mapping, decimal: (e.target.value || undefined) as CsvMapping['decimal'] })}>
            <option value="">{t('banking.detect', { defaultValue: 'Detect' })}</option>
            <option value=",">1.234,56</option>
            <option value=".">1,234.56</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-content-secondary">{t('banking.map_date_format', { defaultValue: 'Date format' })}</span>
          <select className={clsx(inputCls, 'max-w-[220px]')} value={mapping.date_format ?? ''} onChange={(e) => onChange({ ...mapping, date_format: e.target.value || undefined })}>
            <option value="">{t('banking.detect', { defaultValue: 'Detect' })}</option>
            <option value="%d.%m.%Y">31.12.2026</option>
            <option value="%d/%m/%Y">31/12/2026</option>
            <option value="%m/%d/%Y">12/31/2026</option>
            <option value="%Y-%m-%d">2026-12-31</option>
          </select>
        </label>
      </div>
      {sample.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border-light">
          <table className="w-full text-xs">
            <thead className="bg-surface-secondary">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-content-secondary">
                    <div>{h}</div>
                    <div className={clsx('text-[10px] font-normal', used.has(h) ? 'text-oe-blue' : 'text-content-tertiary')}>
                      {used.has(h) ? `→ ${t(`banking.map_${used.get(h)}`, { defaultValue: LABELS[used.get(h)!] })}` : t('banking.map_unused', { defaultValue: 'not used' })}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sample.map((row, i) => (
                <tr key={i} className="border-t border-border-light">
                  {headers.map((h, j) => (
                    <td key={h} className={clsx('max-w-[14rem] truncate whitespace-nowrap px-2 py-1', used.has(h) ? 'text-content-primary' : 'text-content-tertiary')}>
                      {row[j] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
