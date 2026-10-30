import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Landmark } from 'lucide-react';
import { Badge, DateDisplay, EmptyState, MoneyDisplay, SkeletonTable } from '@/shared/ui';
import type { BankTransaction } from '../api';
import { openAmount } from '../logic';

export const STATUS_VARIANT = { unmatched: 'warning', partially_matched: 'blue', matched: 'success', ignored: 'neutral' } as const;

interface Props {
  rows: BankTransaction[];
  loading: boolean;
  currentId: string | undefined;
  onSelect: (index: number) => void;
  onImport: () => void;
}

export function BankLineList({ rows, loading, currentId, onSelect, onImport }: Props) {
  const { t } = useTranslation();
  const activeRef = useRef<HTMLButtonElement | null>(null);
  // Keep the keyboard-selected line in view while stepping with J/K.
  useEffect(() => activeRef.current?.scrollIntoView({ block: 'nearest' }), [currentId]);
  if (loading) return <div className="p-4"><SkeletonTable rows={8} columns={2} /></div>;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Landmark size={22} />}
        title={t('banking.no_lines', { defaultValue: 'Nothing to reconcile here' })}
        description={t('banking.no_lines_desc', { defaultValue: 'Import a statement or change the filter.' })}
        action={{ label: t('banking.new_import', { defaultValue: 'Import statement' }), onClick: onImport }}
      />
    );
  }
  return (
    <ul role="listbox" aria-label={t('banking.lines', { defaultValue: 'Bank lines' })}>
      {rows.map((r, i) => {
        const active = r.id === currentId;
        const partial = r.status === 'partially_matched';
        return (
          <li key={r.id}>
            <button
              ref={active ? activeRef : undefined}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => onSelect(i)}
              className={clsx(
                'flex w-full items-start justify-between gap-3 border-b border-l-2 border-b-border-light px-3 py-2.5 text-left text-sm transition-colors',
                active ? 'border-l-oe-blue bg-oe-blue/5' : 'border-l-transparent hover:bg-surface-secondary',
              )}
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-content-primary">{r.counterparty_name || '—'}</div>
                <div className="truncate text-xs text-content-tertiary">
                  <DateDisplay value={r.booking_date} /> · {r.remittance || r.reference || '—'}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <MoneyDisplay amount={r.amount} currency={r.currency} colorize className="font-medium tabular-nums" />
                <div className="mt-0.5 flex items-center justify-end gap-1">
                  {partial && (
                    <span className="text-[11px] text-content-tertiary">
                      <MoneyDisplay amount={openAmount(r)} currency={r.currency} compact />
                    </span>
                  )}
                  <Badge size="sm" variant={STATUS_VARIANT[r.status]}>
                    {t(`banking.status_${r.status}`, { defaultValue: r.status.replace('_', ' ') })}
                  </Badge>
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
