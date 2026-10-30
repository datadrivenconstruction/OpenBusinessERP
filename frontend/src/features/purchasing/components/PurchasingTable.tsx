import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { DateDisplay } from '@/shared/ui/DateDisplay';
import { Badge } from '@/shared/ui/Badge';
import { MatchChip } from '../MatchChip';
import { docKind, type PurchasingDocSummary } from '../api';
import { balanceDue, dueTone } from '../helpers';
import { ReceivedBar, StatusBadge, SupplierAvatar } from './common';
import { RowActionsMenu, type RowAction } from './RowActionsMenu';

interface Props {
  isOrder: boolean;
  rows: PurchasingDocSummary[];
  sort: string;
  onSort: (field: string) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onAction: (a: RowAction, d: PurchasingDocSummary) => void;
}

const th = 'px-3 py-2.5 font-medium';
const td = 'px-3 py-2';

function SortHeader({ field, label, sort, onSort, align = 'left' }: { field: string; label: string; sort: string; onSort: (f: string) => void; align?: 'left' | 'right' }) {
  const active = sort.replace(/^-/, '') === field;
  const desc = sort.startsWith('-');
  const Icon = !active ? ArrowUpDown : desc ? ArrowDown : ArrowUp;
  return (
    <th className={clsx(th, align === 'right' ? 'text-right' : 'text-left')} aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => onSort(field)} className={clsx('inline-flex items-center gap-1 uppercase hover:text-content-primary', active && 'text-content-primary')}>
        {label}
        <Icon size={12} className={active ? '' : 'opacity-40'} />
      </button>
    </th>
  );
}

export function PurchasingTable({ isOrder, rows, sort, onSort, selected, onToggle, onToggleAll, onAction }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const sh = { sort, onSort };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-secondary text-xs uppercase tracking-wide text-content-tertiary">
          <tr>
            <th className="w-10 px-3">
              <input type="checkbox" aria-label={t('purchasing.select_all', { defaultValue: 'Select all' })} checked={allOn} onChange={onToggleAll} />
            </th>
            <SortHeader field="number" label={t('purchasing.col_number', { defaultValue: 'Number' })} {...sh} />
            <SortHeader field="supplier_name" label={t('purchasing.col_supplier', { defaultValue: 'Supplier' })} {...sh} />
            <SortHeader field="doc_date" label={t('purchasing.col_date', { defaultValue: 'Date' })} {...sh} />
            <SortHeader
              field="due_date"
              label={isOrder ? t('purchasing.col_expected', { defaultValue: 'Expected' }) : t('purchasing.col_due', { defaultValue: 'Due' })}
              {...sh}
            />
            <th className={clsx(th, 'text-left')}>{t('purchasing.col_status', { defaultValue: 'Status' })}</th>
            {isOrder ? (
              <th className={clsx(th, 'text-left')}>{t('purchasing.col_received', { defaultValue: 'Received' })}</th>
            ) : (
              <th className={clsx(th, 'text-left')}>{t('purchasing.col_match', { defaultValue: 'Match' })}</th>
            )}
            <SortHeader field="net_total" align="right" label={t('purchasing.col_net', { defaultValue: 'Net' })} {...sh} />
            <SortHeader field="gross_total" align="right" label={t('purchasing.col_gross', { defaultValue: 'Gross' })} {...sh} />
            {!isOrder && <SortHeader field="balance_due" align="right" label={t('purchasing.col_balance', { defaultValue: 'Balance due' })} {...sh} />}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const due = balanceDue(d);
            const credit = d.kind === 'credit_note';
            const openDoc = isOrder ? !['received', 'closed', 'cancelled', 'draft'].includes(d.status) : due > 0 && !['draft', 'cancelled'].includes(d.status);
            const tone = d.is_overdue ? 'overdue' : dueTone(d.due_date, openDoc);
            const href = `/purchasing/${docKind(d)}/${d.id}`;
            return (
              <tr
                key={d.id}
                className={clsx('cursor-pointer border-t border-border-light hover:bg-surface-secondary', selected.has(d.id) && 'bg-oe-blue-subtle/40')}
                onClick={() => navigate(href)}
              >
                <td className="px-3" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={d.number} checked={selected.has(d.id)} onChange={() => onToggle(d.id)} />
                </td>
                <td className={clsx(td, 'font-mono text-xs')}>
                  <Link to={href} onClick={(e) => e.stopPropagation()} className="text-content-primary hover:underline">
                    {d.number}
                  </Link>
                  {credit && (
                    <Badge size="sm" variant="purple" className="ml-1.5">
                      {t('purchasing.credit_note_short', { defaultValue: 'CN' })}
                    </Badge>
                  )}
                </td>
                <td className={td}>
                  <span className="flex items-center gap-2">
                    <SupplierAvatar name={d.supplier_name} />
                    <span className="max-w-[220px] truncate">{d.supplier_name || '—'}</span>
                  </span>
                </td>
                <td className={clsx(td, 'text-content-secondary')}>
                  <DateDisplay value={d.doc_date} />
                </td>
                <td
                  className={clsx(
                    td,
                    tone === 'overdue' ? 'font-medium text-semantic-error' : tone === 'soon' ? 'text-[#b45309]' : 'text-content-secondary',
                  )}
                >
                  {d.due_date ? <DateDisplay value={d.due_date} /> : '—'}
                  {tone === 'overdue' && <span className="ml-1 text-2xs uppercase">{t('purchasing.overdue', { defaultValue: 'overdue' })}</span>}
                </td>
                <td className={td}>
                  <StatusBadge status={d.status} size="sm" />
                </td>
                <td className={td}>
                  {isOrder ? <ReceivedBar pct={Number(d.received_pct ?? 0)} /> : credit ? '—' : <MatchChip status={d.match_status} />}
                </td>
                <td className={clsx(td, 'text-right tabular-nums text-content-secondary')}>
                  <MoneyDisplay amount={credit ? -Number(d.net_total) : d.net_total} currency={d.currency} />
                </td>
                <td className={clsx(td, 'text-right tabular-nums')}>
                  <MoneyDisplay amount={credit ? -Number(d.gross_total) : d.gross_total} currency={d.currency} />
                </td>
                {!isOrder && (
                  <td className={clsx(td, 'text-right tabular-nums', due > 0 && tone === 'overdue' && 'text-semantic-error')}>
                    <MoneyDisplay amount={credit ? -due : due} currency={d.currency} />
                  </td>
                )}
                <td className="px-2 text-right" onClick={(e) => e.stopPropagation()}>
                  <RowActionsMenu doc={d} isOrder={isOrder} onAction={(a) => onAction(a, d)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
