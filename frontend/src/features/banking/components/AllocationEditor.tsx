import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Plus, Search, X } from 'lucide-react';
import { Button, DateDisplay, MoneyDisplay } from '@/shared/ui';
import type { BankTransaction, OpenItem } from '../api';
import {
  addDraft,
  allocatedOf,
  candidatesFor,
  clampDrafts,
  draftDifference,
  draftProblem,
  removeDraft,
  setDraftAmount,
  writeOffResidual,
  type DraftAlloc,
} from '../reconcile';
import { inputCls } from '../modals/AccountFormModal';

interface Props {
  line: BankTransaction;
  lineOpen: number;
  items: OpenItem[];
  drafts: DraftAlloc[];
  onChange: (d: DraftAlloc[]) => void;
  writeOffMax: number;
  writeOff: boolean;
  onWriteOff: (v: boolean) => void;
  busy: boolean;
  onConfirm: () => void;
}

/** Build a split or partial allocation by hand: pick open items and set how much each one takes. */
export function AllocationEditor({ line, lineOpen, items, drafts, onChange, writeOffMax, writeOff, onWriteOff, busy, onConfirm }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const ccy = line.currency;
  const candidates = useMemo(
    () => candidatesFor(line, items, query, drafts.map((d) => d.id)).slice(0, 8),
    [line, items, query, drafts],
  );
  const problem = draftProblem(drafts, lineOpen);
  const diff = draftDifference(drafts, lineOpen);
  const residual = writeOffResidual(drafts, writeOffMax);
  const canWriteOff = residual > 0;
  const problemText = {
    empty: t('banking.alloc_empty', { defaultValue: 'Pick at least one open item.' }),
    zero: t('banking.alloc_zero', { defaultValue: 'Every allocation needs an amount above zero.' }),
    over_item: t('banking.alloc_over_item', { defaultValue: 'An allocation is larger than what the item still owes.' }),
    over_line: t('banking.alloc_over_line', { defaultValue: 'Allocations add up to more than the line.' }),
  };
  return (
    <div className="space-y-3">
      {drafts.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs text-content-tertiary">
            <tr>
              <th className="py-1 text-left font-medium">{t('banking.col_document', { defaultValue: 'Document' })}</th>
              <th className="py-1 text-right font-medium">{t('banking.col_open', { defaultValue: 'Open' })}</th>
              <th className="py-1 text-right font-medium">{t('banking.col_allocate', { defaultValue: 'Allocate' })}</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => (
              <tr key={d.id} className="border-t border-border-light">
                <td className="py-1.5">
                  <div className="font-medium text-content-primary">{d.number}</div>
                  {d.partner_name && <div className="text-xs text-content-tertiary">{d.partner_name}</div>}
                </td>
                <td className="py-1.5 text-right text-content-secondary"><MoneyDisplay amount={d.open} currency={ccy} /></td>
                <td className="py-1.5 text-right">
                  <input
                    aria-label={t('banking.col_allocate', { defaultValue: 'Allocate' })}
                    className={clsx(inputCls, 'ml-auto h-8 w-28 text-right tabular-nums')}
                    inputMode="decimal"
                    value={d.amount}
                    onChange={(e) => onChange(setDraftAmount(drafts, d.id, e.target.value))}
                    onBlur={() => onChange(clampDrafts(drafts))}
                  />
                </td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    aria-label={t('common.remove', { defaultValue: 'Remove' })}
                    className="rounded p-1 text-content-tertiary hover:bg-surface-secondary"
                    onClick={() => onChange(removeDraft(drafts, d.id))}
                  >
                    <X size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-xs">
            <tr className="border-t border-border">
              <td className="py-1.5 text-content-secondary">{t('banking.alloc_total', { defaultValue: 'Allocated / line open' })}</td>
              <td />
              <td className="py-1.5 text-right font-medium tabular-nums">
                <MoneyDisplay amount={allocatedOf(drafts)} currency={ccy} /> / <MoneyDisplay amount={lineOpen} currency={ccy} />
              </td>
              <td />
            </tr>
            {diff !== 0 && (
              <tr>
                <td className="text-content-secondary">
                  {diff > 0
                    ? t('banking.alloc_left', { defaultValue: 'Left on the line (stays partially matched)' })
                    : t('banking.difference', { defaultValue: 'Difference' })}
                </td>
                <td />
                <td className="text-right tabular-nums"><MoneyDisplay amount={diff} currency={ccy} /></td>
                <td />
              </tr>
            )}
          </tfoot>
        </table>
      )}
      <div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-content-tertiary" />
          <input
            className={clsx(inputCls, 'pl-8')}
            placeholder={t('banking.search_open_items', { defaultValue: 'Find an open invoice or bill by number or partner' })}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <ul className="mt-1 max-h-48 overflow-y-auto">
          {candidates.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => onChange(addDraft(drafts, i, lineOpen))}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-secondary"
              >
                <span className="min-w-0">
                  <span className="font-medium text-content-primary">{i.number}</span>{' '}
                  <span className="text-xs text-content-tertiary">
                    {i.partner_name}
                    {i.due_date && <> · <DateDisplay value={i.due_date} /></>}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <MoneyDisplay amount={i.open_amount} currency={i.currency} />
                  <Plus size={13} className="text-oe-blue" />
                </span>
              </button>
            </li>
          ))}
          {candidates.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-content-tertiary">
              {t('banking.no_open_items', { defaultValue: 'No matching open items.' })}
            </li>
          )}
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {problem && drafts.length > 0 ? (
          <span className="text-xs text-semantic-error">{problemText[problem]}</span>
        ) : canWriteOff ? (
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={writeOff} onChange={(e) => onWriteOff(e.target.checked)} />
            {t('banking.write_off', { defaultValue: 'Write off the difference' })}
            <MoneyDisplay amount={residual} currency={ccy} className="text-content-secondary" />
          </label>
        ) : (
          <span />
        )}
        <Button size="sm" disabled={!!problem || busy} loading={busy} onClick={onConfirm}>
          {t('banking.confirm_allocation', { defaultValue: 'Confirm allocation' })}
        </Button>
      </div>
    </div>
  );
}
