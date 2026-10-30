import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { MatchChip } from '../MatchChip';
import { lineTotals, type PurchasingLine } from '../api';
import type { LineError } from '../helpers';
import { remainingQty } from '../modals/ReceiveDialog';
import { cellInput } from './common';
import { ItemPicker } from './ItemPicker';

const COMMON_RATES = [0, 5, 7, 10, 19, 20, 21];

interface Props {
  lines: PurchasingLine[];
  editable: boolean;
  currency: string;
  baseTax: string;
  showReceived: boolean;
  showMatch: boolean;
  errors: LineError[];
  showErrors: boolean;
  onChange: (lines: PurchasingLine[]) => void;
  newLine: () => PurchasingLine;
}

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = [...arr];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x as T);
  return next;
}

export function LineEditor({ lines, editable, currency, baseTax, showReceived, showMatch, errors, showErrors, onChange, newLine }: Props) {
  const { t } = useTranslation();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const focusLast = useRef(false);
  useEffect(() => {
    if (!focusLast.current) return;
    focusLast.current = false;
    tbody.current?.querySelector<HTMLInputElement>('tr:last-child input[data-field="description"]')?.focus();
  }, [lines.length]);

  const set = (i: number, patch: Partial<PurchasingLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const add = () => {
    focusLast.current = true;
    onChange([...lines, newLine()]);
  };
  const rates = (cur: string) => [...new Set([...COMMON_RATES, Number(baseTax) || 0, Number(cur) || 0])].sort((a, b) => a - b);
  const err = (i: number, k: keyof LineError) => showErrors && !!errors[i]?.[k];

  return (
    <div className="overflow-x-auto rounded-xl border border-border-light bg-surface-elevated shadow-xs">
      <table className="w-full min-w-[960px] text-sm">
        <thead className="bg-surface-secondary text-left text-xs text-content-tertiary">
          <tr>
            {editable && <th className="w-6" />}
            <th className="w-40 px-2 py-2 font-medium">{t('purchasing.item', { defaultValue: 'Item' })}</th>
            <th className="px-2 py-2 font-medium">{t('purchasing.description', { defaultValue: 'Description' })}</th>
            <th className="w-20 px-2 py-2 text-right font-medium">{t('purchasing.qty', { defaultValue: 'Qty' })}</th>
            <th className="w-28 px-2 py-2 text-right font-medium">{t('purchasing.unit_price', { defaultValue: 'Unit price' })}</th>
            <th className="w-20 px-2 py-2 text-right font-medium">{t('purchasing.discount', { defaultValue: 'Disc. %' })}</th>
            <th className="w-24 px-2 py-2 text-right font-medium">{t('purchasing.tax_rate', { defaultValue: 'Tax %' })}</th>
            <th className="w-28 px-2 py-2 text-right font-medium">{t('purchasing.net', { defaultValue: 'Net' })}</th>
            {showReceived && <th className="w-28 px-2 py-2 text-right font-medium">{t('purchasing.received', { defaultValue: 'Received' })}</th>}
            {showMatch && <th className="w-32 px-2 py-2 font-medium">{t('purchasing.col_match', { defaultValue: 'Match' })}</th>}
            {editable && <th className="w-8" />}
          </tr>
        </thead>
        <tbody ref={tbody}>
          {lines.map((l, i) => (
            <tr
              key={l.id ?? `n${i}`}
              className={clsx('border-t border-border-light', drag === i && 'opacity-50', over === i && drag !== null && drag !== i && 'border-t-2 border-t-oe-blue')}
              onDragOver={(e) => {
                if (drag === null) return;
                e.preventDefault();
                setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null) onChange(moveItem(lines, drag, i));
                setDrag(null);
                setOver(null);
              }}
              onKeyDown={(e) => {
                if (editable && e.key === 'Enter' && !e.defaultPrevented && (e.target as HTMLElement).tagName === 'INPUT' && i === lines.length - 1) {
                  e.preventDefault();
                  add();
                }
              }}
            >
              {editable && (
                <td
                  className="cursor-grab px-1 text-content-tertiary"
                  draggable
                  aria-label={t('purchasing.drag_line', { defaultValue: 'Drag to reorder' })}
                  onDragStart={(e) => {
                    setDrag(i);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(i));
                  }}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                >
                  <GripVertical size={14} />
                </td>
              )}
              <td className="px-2 py-1">
                {editable ? (
                  <ItemPicker
                    sku={l.sku}
                    onSku={(sku) => set(i, { sku, item_id: null })}
                    onPick={(it) => set(i, { item_id: it.id, sku: it.sku, description: it.name, unit_price: String(it.purchase_cost ?? l.unit_price) })}
                  />
                ) : (
                  <span className="font-mono text-xs">{l.sku || '—'}</span>
                )}
              </td>
              <td className="px-2 py-1">
                <input
                  data-field="description"
                  className={clsx(cellInput, err(i, 'description') && 'border-semantic-error')}
                  aria-invalid={err(i, 'description')}
                  disabled={!editable}
                  value={l.description}
                  onChange={(e) => set(i, { description: e.target.value })}
                />
              </td>
              {(['qty', 'unit_price', 'discount_pct'] as const).map((k) => (
                <td key={k} className="px-2 py-1">
                  <input
                    className={clsx(cellInput, 'text-right tabular-nums', err(i, k) && 'border-semantic-error')}
                    aria-invalid={err(i, k)}
                    aria-label={k}
                    inputMode="decimal"
                    disabled={!editable}
                    value={l[k] ?? ''}
                    placeholder={k === 'discount_pct' ? '0' : undefined}
                    onChange={(e) => set(i, { [k]: e.target.value })}
                  />
                </td>
              ))}
              <td className="px-2 py-1">
                <select
                  className={clsx(cellInput, 'text-right')}
                  aria-label={t('purchasing.tax_rate', { defaultValue: 'Tax %' })}
                  disabled={!editable}
                  value={String(Number(l.tax_rate) || 0)}
                  onChange={(e) => set(i, { tax_rate: e.target.value })}
                >
                  {rates(l.tax_rate).map((r) => (
                    <option key={r} value={String(r)}>{r}%</option>
                  ))}
                </select>
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                <MoneyDisplay amount={lineTotals(l).net} currency={currency} />
              </td>
              {showReceived && (
                <td className="px-2 py-1 text-right tabular-nums text-content-secondary">
                  {Number(l.qty_received ?? 0)} / {Number(l.qty)}
                  {remainingQty(l) > 0 && <div className="text-2xs text-[#b45309]">{t('purchasing.remaining_n', { defaultValue: '{{n}} open', n: remainingQty(l) })}</div>}
                </td>
              )}
              {showMatch && (
                <td className="px-2 py-1">
                  <MatchChip status={l.match_status} />
                </td>
              )}
              {editable && (
                <td className="px-1 py-1">
                  <button
                    type="button"
                    aria-label={t('common.delete', { defaultValue: 'Delete' })}
                    className="text-content-tertiary hover:text-semantic-error"
                    onClick={() => onChange(lines.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <div className="flex items-center justify-between border-t border-border-light px-2 py-1.5">
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={add}>
            {t('purchasing.add_line', { defaultValue: 'Add line' })}
          </Button>
          <span className="text-2xs text-content-tertiary">{t('purchasing.enter_hint', { defaultValue: 'Enter on the last line adds a new one' })}</span>
        </div>
      )}
    </div>
  );
}
