import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button, MoneyDisplay } from '@/shared/ui';
import { lineTotals, type SalesLine } from '../api';
import { emptyLine } from '../lib/form';
import { moveItem, type LineError } from '../lib/totals';
import { ItemPicker } from './ItemPicker';

const input =
  'w-full rounded border border-border-light bg-surface-primary px-2 py-1 text-sm text-content-primary focus:border-oe-blue focus:outline-none disabled:border-transparent disabled:bg-transparent aria-[invalid=true]:border-semantic-error';

export function LineEditor({
  lines,
  onChange,
  editable,
  currency,
  taxRates,
  defaultTax,
  errors,
}: {
  lines: SalesLine[];
  onChange: (lines: SalesLine[]) => void;
  editable: boolean;
  currency: string;
  taxRates: number[];
  defaultTax: string;
  errors: LineError[];
}) {
  const { t } = useTranslation();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const descRefs = useRef<(HTMLInputElement | null)[]>([]);
  const setLine = (i: number, patch: Partial<SalesLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = (after = lines.length - 1) => {
    const next = [...lines];
    next.splice(after + 1, 0, emptyLine(defaultTax));
    onChange(next);
    window.setTimeout(() => descRefs.current[after + 1]?.focus(), 0);
  };
  const err = (i: number, f: LineError['field']) => errors.find((e) => e.index === i && e.field === f);
  const msg = (e: LineError) =>
    e.code === 'required'
      ? t('sales.validation.line_required', { defaultValue: 'Describe the line or pick an item' })
      : e.code === 'range'
        ? t('sales.validation.discount_range', { defaultValue: 'Discount must be 0–100 %' })
        : t('sales.validation.positive', { defaultValue: 'Must be above zero' });
  const showRemaining = lines.some((l) => l.remaining_qty != null && Number(l.remaining_qty) !== Number(l.qty));
  const onKey = (i: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addLine(i);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-surface-secondary text-left text-xs text-content-tertiary">
          <tr>
            <th className="w-6" />
            <th className="w-24 px-2 py-2 font-medium">{t('sales.sku', { defaultValue: 'SKU' })}</th>
            <th className="px-2 py-2 font-medium">{t('sales.description', { defaultValue: 'Description' })}</th>
            <th className="w-[4.5rem] px-2 py-2 text-right font-medium">{t('sales.qty', { defaultValue: 'Qty' })}</th>
            <th className="w-24 px-2 py-2 text-right font-medium">{t('sales.unit_price', { defaultValue: 'Unit price' })}</th>
            <th className="w-[4.5rem] px-2 py-2 text-right font-medium">{t('sales.discount', { defaultValue: 'Disc. %' })}</th>
            <th className="w-[5.5rem] px-2 py-2 text-right font-medium">{t('sales.tax_rate', { defaultValue: 'Tax %' })}</th>
            <th className="w-32 whitespace-nowrap px-2 py-2 text-right font-medium">{t('sales.net', { defaultValue: 'Net' })}</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const descErr = err(i, 'description');
            const rowErrs = errors.filter((e) => e.index === i && e.field !== 'description');
            return (
              <tr
                key={l.id ?? `new-${i}`}
                draggable={editable && drag === i}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  setDrag(i);
                }}
                onDragOver={(e) => {
                  if (drag == null) return;
                  e.preventDefault();
                  setOver(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag != null) onChange(moveItem(lines, drag, i));
                  setDrag(null);
                  setOver(null);
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
                className={clsx('border-t border-border-light align-top', over === i && drag !== i && 'border-t-2 border-t-oe-blue', drag === i && 'opacity-50')}
              >
                <td className="py-1.5 pl-1">
                  {editable && (
                    <span
                      className="flex h-7 cursor-grab items-center text-content-tertiary"
                      onMouseDown={() => setDrag(i)}
                      onMouseUp={() => setDrag(null)}
                      aria-label={t('sales.lines.drag', { defaultValue: 'Drag to reorder' })}
                    >
                      <GripVertical size={14} />
                    </span>
                  )}
                </td>
                <td className="px-2 py-1">
                  <input className={input} disabled={!editable} value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value, item_id: null })} onKeyDown={onKey(i)} />
                </td>
                <td className="px-2 py-1">
                  <ItemPicker
                    className={input}
                    disabled={!editable}
                    invalid={!!descErr}
                    inputRef={(el) => {
                      descRefs.current[i] = el;
                    }}
                    value={l.description}
                    onChange={(v) => setLine(i, { description: v })}
                    onEnter={() => addLine(i)}
                    onPick={(it) => setLine(i, { item_id: it.id, sku: it.sku, description: it.name, unit_price: String(it.sales_price ?? '0') })}
                  />
                  {descErr && <p className="mt-0.5 text-2xs text-semantic-error">{msg(descErr)}</p>}
                  {rowErrs.map((e) => (
                    <p key={e.field} className="mt-0.5 text-2xs text-semantic-error">
                      {t(`sales.${e.field === 'discount_pct' ? 'discount' : e.field}`, { defaultValue: e.field })}: {msg(e)}
                    </p>
                  ))}
                  {showRemaining && l.remaining_qty != null && (
                    <p className="mt-0.5 text-2xs text-content-tertiary">
                      {t('sales.lines.remaining', { defaultValue: 'Remaining: {{qty}}', qty: l.remaining_qty })}
                    </p>
                  )}
                </td>
                {(['qty', 'unit_price', 'discount_pct'] as const).map((k) => (
                  <td key={k} className="px-2 py-1">
                    <input
                      className={clsx(input, 'text-right tabular-nums')}
                      inputMode="decimal"
                      disabled={!editable}
                      aria-invalid={!!err(i, k)}
                      value={editable ? l[k] : trimDec(l[k])}
                      onChange={(e) => setLine(i, { [k]: e.target.value })}
                      onKeyDown={onKey(i)}
                    />
                  </td>
                ))}
                <td className="px-2 py-1">
                  <select
                    className={clsx(input, 'text-right')}
                    disabled={!editable}
                    value={String(Number(l.tax_rate) || 0)}
                    onChange={(e) => setLine(i, { tax_rate: e.target.value })}
                  >
                    {taxRates.map((r) => (
                      <option key={r} value={String(r)}>
                        {r} %
                      </option>
                    ))}
                  </select>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                  <MoneyDisplay amount={lineTotals(l).net} currency={currency} />
                </td>
                <td className="px-1 py-1.5">
                  {editable && lines.length > 1 && (
                    <button
                      type="button"
                      aria-label={t('common.delete', { defaultValue: 'Delete' })}
                      className="text-content-tertiary hover:text-semantic-error"
                      onClick={() => onChange(lines.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editable && (
        <div className="flex items-center gap-3 border-t border-border-light px-2 py-1.5">
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => addLine()}>
            {t('sales.add_line', { defaultValue: 'Add line' })}
          </Button>
          <span className="text-2xs text-content-tertiary">
            {t('sales.lines.enter_hint', { defaultValue: 'Enter adds a line · drag the handle to reorder' })}
          </span>
        </div>
      )}
    </div>
  );
}

// Read-only cells: show 51.3 / 3 instead of the API's 51.3000 / 3.0000.
function trimDec(v: string): string {
  return /^-?\d+\.\d+$/.test(v) ? v.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1') : v;
}
