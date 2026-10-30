import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Badge, DateDisplay, MoneyDisplay } from '@/shared/ui';
import { STATUS_VARIANT, type SalesDocSummary, type SalesKind } from '../api';
import { nextSort } from '../lib/filters';
import { balanceDue, isOverdue } from '../lib/totals';
import { CustomerAvatar } from './CustomerAvatar';
import { RowActions, type RowActionHandlers } from './RowActions';

const th = 'px-3 py-2.5 font-medium';
const td = 'px-3 py-2';

function SortHeader({
  column,
  sort,
  onSort,
  label,
  align = 'left',
}: {
  column: string;
  sort: string;
  onSort: (s: string) => void;
  label: string;
  align?: 'left' | 'right';
}) {
  const active = sort === column || sort === `-${column}`;
  const Icon = !active ? ArrowUpDown : sort.startsWith('-') ? ArrowDown : ArrowUp;
  return (
    <th
      className={clsx(th, align === 'right' ? 'text-right' : 'text-left')}
      aria-sort={!active ? 'none' : sort.startsWith('-') ? 'descending' : 'ascending'}
    >
      <button
        type="button"
        onClick={() => onSort(nextSort(sort, column))}
        className={clsx('inline-flex items-center gap-1 uppercase hover:text-content-primary', active && 'text-content-primary')}
      >
        {label}
        <Icon size={12} className={active ? '' : 'opacity-40'} />
      </button>
    </th>
  );
}

export function SalesTable({
  kind,
  rows,
  sort,
  onSort,
  selected,
  onToggle,
  onToggleAll,
  actions,
}: {
  kind: SalesKind;
  rows: SalesDocSummary[];
  sort: string;
  onSort: (s: string) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (on: boolean) => void;
  actions: RowActionHandlers;
}) {
  const { t } = useTranslation();
  const showBalance = kind === 'invoices' || kind === 'credit-notes';
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOn = rows.some((r) => selected.has(r.id));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-secondary text-xs tracking-wide text-content-tertiary">
          <tr>
            <th className="w-10 px-3 py-2.5">
              <input
                type="checkbox"
                aria-label={t('sales.select_all', { defaultValue: 'Select all' })}
                checked={allOn}
                ref={(el) => {
                  if (el) el.indeterminate = someOn && !allOn;
                }}
                onChange={(e) => onToggleAll(e.target.checked)}
              />
            </th>
            <SortHeader column="number" sort={sort} onSort={onSort} label={t('sales.col_number', { defaultValue: 'Number' })} />
            <SortHeader column="customer_name" sort={sort} onSort={onSort} label={t('sales.col_customer', { defaultValue: 'Customer' })} />
            <SortHeader column="doc_date" sort={sort} onSort={onSort} label={t('sales.col_date', { defaultValue: 'Date' })} />
            <SortHeader column="due_date" sort={sort} onSort={onSort} label={t('sales.col_due', { defaultValue: 'Due' })} />
            <th className={clsx(th, 'text-left uppercase')}>{t('sales.col_status', { defaultValue: 'Status' })}</th>
            <th className={clsx(th, 'text-right uppercase')}>{t('sales.col_net', { defaultValue: 'Net' })}</th>
            <SortHeader column="gross_total" sort={sort} onSort={onSort} align="right" label={t('sales.col_gross', { defaultValue: 'Gross' })} />
            {showBalance && (
              <SortHeader column="balance_due" sort={sort} onSort={onSort} align="right" label={t('sales.col_balance', { defaultValue: 'Balance due' })} />
            )}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const overdue = isOverdue(d);
            const bal = balanceDue(d);
            const on = selected.has(d.id);
            return (
              <tr
                key={d.id}
                className={clsx('group border-t border-border-light hover:bg-surface-secondary', on && 'bg-oe-blue-subtle/40')}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={t('sales.select_row', { defaultValue: 'Select {{number}}', number: d.number })}
                    checked={on}
                    onChange={() => onToggle(d.id)}
                  />
                </td>
                <td className={clsx(td, 'font-mono text-xs')}>
                  <Link to={`/sales/${kind}/${d.id}`} className="font-medium text-content-primary hover:text-oe-blue hover:underline">
                    {d.number || t('sales.unnumbered', { defaultValue: 'Draft' })}
                  </Link>
                </td>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <CustomerAvatar name={d.customer_name} />
                    <span className="truncate text-content-primary">{d.customer_name || '—'}</span>
                  </div>
                </td>
                <td className={clsx(td, 'whitespace-nowrap text-content-secondary')}>
                  <DateDisplay value={d.doc_date} />
                </td>
                <td className={clsx(td, 'whitespace-nowrap', overdue ? 'font-medium text-semantic-error' : 'text-content-secondary')}>
                  {d.due_date ? <DateDisplay value={d.due_date} /> : '—'}
                </td>
                <td className={td}>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant={STATUS_VARIANT[d.status] ?? 'neutral'} dot size="sm">
                      {t(`sales.status_${d.status}`, { defaultValue: d.status.replace('_', ' ') })}
                    </Badge>
                    {overdue && (
                      <Badge variant="error" size="sm">
                        {t('sales.status_overdue', { defaultValue: 'overdue' })}
                      </Badge>
                    )}
                  </div>
                </td>
                <td className={clsx(td, 'text-right tabular-nums text-content-secondary')}>
                  <MoneyDisplay amount={d.net_total} currency={d.currency} />
                </td>
                <td className={clsx(td, 'text-right font-medium tabular-nums')}>
                  <MoneyDisplay amount={d.gross_total} currency={d.currency} />
                </td>
                {showBalance && (
                  <td className={clsx(td, 'text-right tabular-nums', bal > 0 && overdue && 'text-semantic-error')}>
                    <MoneyDisplay amount={bal} currency={d.currency} />
                  </td>
                )}
                <td className="px-1 py-1 text-right">
                  <RowActions doc={d} handlers={actions} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
