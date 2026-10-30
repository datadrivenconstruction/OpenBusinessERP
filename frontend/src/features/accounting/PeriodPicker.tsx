import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RANGE_PRESETS, glApi, presetRange, type RangePreset } from './api';
import { Field, inputCls } from './ui';

interface Props {
  from: string;
  to: string;
  onChange: (r: { from: string; to: string }) => void;
  /** Balance sheet style: a single "as of" date. */
  single?: boolean;
}

const PRESET_LABEL: Record<RangePreset, string> = {
  month: 'This month',
  last_month: 'Last month',
  quarter: 'This quarter',
  year: 'This year',
  last_year: 'Last year',
};

/** Preset ranges, fiscal periods from the ledger, and free date inputs. */
export function PeriodPicker({ from, to, onChange, single }: Props) {
  const { t } = useTranslation();
  const years = useQuery({ queryKey: ['gl', 'fiscal-years'], queryFn: glApi.fiscalYears, retry: false });
  const periods = (years.data ?? []).flatMap((y) => y.periods);

  const onSelect = (v: string) => {
    if (!v) return;
    if (v.startsWith('p:')) {
      const p = periods.find((x) => x.id === v.slice(2));
      if (p) onChange({ from: p.start_date, to: p.end_date });
    } else {
      onChange(presetRange(v as RangePreset));
    }
  };

  const current =
    RANGE_PRESETS.find((p) => {
      const r = presetRange(p);
      return r.from === from && r.to === to;
    }) ?? '';
  const currentPeriod = periods.find((p) => p.start_date === from && p.end_date === to);
  const value = currentPeriod ? `p:${currentPeriod.id}` : current;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t('accounting.period', { defaultValue: 'Period' })}>
        <select className={inputCls} value={value} onChange={(e) => onSelect(e.target.value)}>
          <option value="">{t('accounting.period_custom', { defaultValue: 'Custom' })}</option>
          {RANGE_PRESETS.map((p) => (
            <option key={p} value={p}>
              {t(`accounting.preset_${p}`, { defaultValue: PRESET_LABEL[p] })}
            </option>
          ))}
          {periods.length > 0 && (
            <optgroup label={t('accounting.fiscal_periods', { defaultValue: 'Fiscal periods' })}>
              {periods.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>{p.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </Field>
      {!single && (
        <Field label={t('accounting.from', { defaultValue: 'From' })}>
          <input type="date" className={inputCls} value={from} max={to || undefined} onChange={(e) => onChange({ from: e.target.value, to })} />
        </Field>
      )}
      <Field label={single ? t('accounting.as_of', { defaultValue: 'As of' }) : t('accounting.to', { defaultValue: 'To' })}>
        <input type="date" className={inputCls} value={to} min={single ? undefined : from || undefined} onChange={(e) => onChange({ from, to: e.target.value })} />
      </Field>
    </div>
  );
}
