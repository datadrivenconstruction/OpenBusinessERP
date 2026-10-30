import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Search, X } from 'lucide-react';
import { ContactSearchInput } from '@/shared/ui/ContactSearchInput';
import { STATUSES_BY_KIND, clearFilters, hasActiveFilters, type SalesFilters } from '../lib/filters';

export const inputCls =
  'h-9 rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

export function SalesFiltersBar({ filters, onChange }: { filters: SalesFilters; onChange: (f: SalesFilters) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState(filters.q);
  useEffect(() => setQ(filters.q), [filters.q]);
  // Debounced search keeps the URL (and the query) from churning per keystroke.
  useEffect(() => {
    if (q === filters.q) return;
    const h = window.setTimeout(() => onChange({ ...filters, q, page: 1 }), 300);
    return () => window.clearTimeout(h);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<SalesFilters>) => onChange({ ...filters, ...patch, page: 1 });
  const toggleStatus = (s: string) =>
    set({ status: filters.status.includes(s) ? filters.status.filter((x) => x !== s) : [...filters.status, s] });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary" />
          <input
            type="search"
            aria-label={t('sales.filters.search', { defaultValue: 'Search number or customer' })}
            placeholder={t('sales.filters.search', { defaultValue: 'Search number or customer' })}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={clsx(inputCls, 'w-full pl-8')}
          />
        </div>
        <div className="w-64 min-w-[200px]">
          <ContactSearchInput
            compact
            value={filters.customer_id}
            displayValue={filters.customer_name}
            placeholder={t('sales.filters.customer', { defaultValue: 'Any customer' })}
            onChange={(id, name) => set({ customer_id: id, customer_name: name })}
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-content-tertiary">
          {t('sales.filters.from', { defaultValue: 'From' })}
          <input type="date" className={inputCls} value={filters.date_from} onChange={(e) => set({ date_from: e.target.value })} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-content-tertiary">
          {t('sales.filters.to', { defaultValue: 'To' })}
          <input type="date" className={inputCls} value={filters.date_to} onChange={(e) => set({ date_to: e.target.value })} />
        </label>
        {filters.tab === 'invoices' && (
          <label className="flex cursor-pointer items-center gap-1.5 text-sm text-content-secondary">
            <input type="checkbox" checked={filters.overdue} onChange={(e) => set({ overdue: e.target.checked })} />
            {t('sales.filters.overdue_only', { defaultValue: 'Overdue only' })}
          </label>
        )}
        {hasActiveFilters(filters) && (
          <button
            type="button"
            onClick={() => onChange(clearFilters(filters))}
            className="inline-flex items-center gap-1 text-sm text-oe-blue hover:underline"
          >
            <X size={14} />
            {t('common.clear_filters', { defaultValue: 'Clear filters' })}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('sales.filters.status', { defaultValue: 'Status' })}>
        {STATUSES_BY_KIND[filters.tab].map((s) => {
          const on = filters.status.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => toggleStatus(s)}
              className={clsx(
                'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                on
                  ? 'border-oe-blue bg-oe-blue-subtle font-medium text-oe-blue-text'
                  : 'border-border-light text-content-secondary hover:border-border hover:text-content-primary',
              )}
            >
              {cap(t(`sales.status_${s}`, { defaultValue: s.replace(/_/g, ' ') }))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
