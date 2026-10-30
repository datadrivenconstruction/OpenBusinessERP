import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { ContactSearchInput } from '@/shared/ui/ContactSearchInput';
import { Button } from '@/shared/ui/Button';
import { MATCH_LABEL, type MatchStatus } from '../api';
import { activeFilterCount, EMPTY_FILTERS, type ListFilters, type ListTab } from '../helpers';
import { inputCls } from './common';

export const STATUS_OPTIONS: Record<ListTab, string[]> = {
  orders: ['draft', 'confirmed', 'partially_received', 'received', 'closed', 'cancelled'],
  bills: ['draft', 'posted', 'partially_paid', 'paid', 'applied', 'cancelled'],
  receipts: [],
};

interface Props {
  tab: ListTab;
  value: ListFilters;
  onChange: (f: ListFilters) => void;
}

export function PurchasingFilters({ tab, value, onChange }: Props) {
  const { t } = useTranslation();
  const [q, setQ] = useState(value.q);
  useEffect(() => setQ(value.q), [value.q]);
  useEffect(() => {
    if (q === value.q) return;
    const h = setTimeout(() => onChange({ ...value, q }), 300);
    return () => clearTimeout(h);
  }, [q, value, onChange]);
  const set = (patch: Partial<ListFilters>) => onChange({ ...value, ...patch });
  const toggleStatus = (s: string) =>
    set({ status: value.status.includes(s) ? value.status.filter((x) => x !== s) : [...value.status, s] });
  const count = activeFilterCount(value);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary" />
          <input
            type="search"
            aria-label={t('common.search', { defaultValue: 'Search…' })}
            placeholder={t('purchasing.search_ph', { defaultValue: 'Number, supplier, reference…' })}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={clsx(inputCls, 'pl-8')}
          />
        </div>
        {tab !== 'receipts' && (
          <div className="w-64 min-w-[200px]">
            <ContactSearchInput
              compact
              value={value.supplier_id}
              displayValue={value.supplier_name}
              onChange={(id, name) => set({ supplier_id: id, supplier_name: name })}
              placeholder={t('purchasing.filter_supplier', { defaultValue: 'Any supplier' })}
            />
          </div>
        )}
        <label className="flex items-center gap-1.5 text-xs text-content-tertiary">
          {t('purchasing.filter_from', { defaultValue: 'From' })}
          <input type="date" className={clsx(inputCls, 'w-36')} value={value.date_from} onChange={(e) => set({ date_from: e.target.value })} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-content-tertiary">
          {t('purchasing.filter_to', { defaultValue: 'To' })}
          <input type="date" className={clsx(inputCls, 'w-36')} value={value.date_to} onChange={(e) => set({ date_to: e.target.value })} />
        </label>
        {tab === 'bills' && (
          <>
            <select
              aria-label={t('purchasing.col_match', { defaultValue: 'Match' })}
              className={clsx(inputCls, 'w-40')}
              value={value.match}
              onChange={(e) => set({ match: e.target.value })}
            >
              <option value="">{t('purchasing.filter_any_match', { defaultValue: 'Any match' })}</option>
              {(Object.keys(MATCH_LABEL) as MatchStatus[]).map((m) => (
                <option key={m} value={m}>
                  {t(`purchasing.match_${m}`, { defaultValue: MATCH_LABEL[m] })}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-content-secondary">
              <input type="checkbox" checked={value.overdue} onChange={(e) => set({ overdue: e.target.checked })} />
              {t('purchasing.filter_overdue', { defaultValue: 'Overdue only' })}
            </label>
          </>
        )}
        {count > 0 && (
          <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => onChange({ ...EMPTY_FILTERS, sort: value.sort })}>
            {t('common.clear_filters', { defaultValue: 'Clear filters' })} ({count})
          </Button>
        )}
      </div>
      {STATUS_OPTIONS[tab].length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('purchasing.col_status', { defaultValue: 'Status' })}>
          {STATUS_OPTIONS[tab].map((s) => {
            const on = value.status.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => toggleStatus(s)}
                className={clsx(
                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  on ? 'border-oe-blue bg-oe-blue-subtle text-oe-blue-text' : 'border-border-light text-content-secondary hover:bg-surface-secondary',
                )}
              >
                {t(`purchasing.status_${s}`, { defaultValue: s.replace(/_/g, ' ') })}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
