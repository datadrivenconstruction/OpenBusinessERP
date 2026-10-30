import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, MoneyDisplay, WideModal } from '@/shared/ui';
import { getErrorMessage } from '@/shared/lib/api';
import { kindPath, salesApi, type ConvertBody, type SalesDoc, type SalesDocSummary } from '../api';
import { useConvert } from '../hooks';

export interface ConvertRow {
  line_id: string;
  max: number;
  qty: string;
}

/** Body for the convert call: omitted when every line is taken in full (server default). */
export function convertBody(rows: ConvertRow[]): ConvertBody {
  const full = rows.every((r) => Number(r.qty) === r.max);
  if (full) return {};
  return { lines: rows.filter((r) => Number(r.qty) > 0).map((r) => ({ line_id: r.line_id, qty: r.qty })) };
}

/** Quote -> order or order -> invoice, with per-line partial quantities bounded by remaining_qty. */
export function ConvertDialog({
  doc,
  onClose,
  onDone,
}: {
  doc: SalesDoc | SalesDocSummary;
  onClose: () => void;
  onDone: (d: SalesDoc) => void;
}) {
  const { t } = useTranslation();
  const kind = kindPath(doc.kind);
  const full = useQuery({
    queryKey: ['sales', kind, doc.id],
    queryFn: () => salesApi.get(kind, doc.id),
    initialData: 'lines' in doc ? doc : undefined,
  });
  const lines = full.data?.lines ?? [];
  const [rows, setRows] = useState<ConvertRow[]>([]);
  useEffect(() => {
    setRows(
      lines
        .filter((l) => l.id)
        .map((l) => {
          const max = Number(l.remaining_qty ?? l.qty) || 0;
          return { line_id: l.id!, max, qty: String(max) };
        }),
    );
  }, [full.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const convert = useConvert();
  const from = doc.kind === 'quote' ? 'quote' : 'order';
  const invalid = rows.some((r) => !(Number(r.qty) >= 0) || Number(r.qty) > r.max);
  const nothing = rows.length > 0 && rows.every((r) => !(Number(r.qty) > 0));
  const preview = useMemo(
    () =>
      rows.reduce((s, r) => {
        const l = lines.find((x) => x.id === r.line_id);
        if (!l) return s;
        return s + (Number(r.qty) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.discount_pct) || 0) / 100);
      }, 0),
    [rows, lines],
  );
  const title =
    from === 'quote'
      ? t('sales.convert.to_order_title', { defaultValue: 'Convert {{number}} to an order', number: doc.number })
      : t('sales.convert.to_invoice_title', { defaultValue: 'Invoice {{number}}', number: doc.number });

  return (
    <WideModal
      open
      onClose={onClose}
      size="lg"
      title={title}
      subtitle={t('sales.convert.subtitle', { defaultValue: 'Take all lines, or lower a quantity to carry over only part of it.' })}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-sm text-content-secondary">
            {t('sales.convert.net_preview', { defaultValue: 'Net' })}:{' '}
            <MoneyDisplay amount={preview} currency={doc.currency} className="font-medium text-content-primary" />
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="primary"
              loading={convert.isPending}
              disabled={invalid || nothing || full.isLoading}
              onClick={() =>
                convert.mutate({ from, id: doc.id, body: convertBody(rows) }, { onSuccess: (d) => onDone(d) })
              }
            >
              {from === 'quote'
                ? t('sales.action_to_order', { defaultValue: 'Convert to order' })
                : t('sales.action_to_invoice', { defaultValue: 'Create invoice' })}
            </Button>
          </div>
        </div>
      }
    >
      {convert.error && <p className="mb-2 text-sm text-semantic-error">{getErrorMessage(convert.error)}</p>}
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-content-tertiary">
          <tr>
            <th className="py-1.5">{t('sales.description', { defaultValue: 'Description' })}</th>
            <th className="w-24 py-1.5 text-right">{t('sales.convert.remaining', { defaultValue: 'Remaining' })}</th>
            <th className="w-32 py-1.5 text-right">{t('sales.convert.take', { defaultValue: 'Take' })}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const l = lines.find((x) => x.id === r.line_id);
            const bad = Number(r.qty) > r.max || !(Number(r.qty) >= 0);
            return (
              <tr key={r.line_id} className="border-t border-border-light">
                <td className="py-1.5 pr-2">
                  <span className="text-content-primary">{l?.description || l?.sku}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums text-content-secondary">{r.max}</td>
                <td className="py-1.5 text-right">
                  <input
                    aria-label={t('sales.convert.take', { defaultValue: 'Take' })}
                    inputMode="decimal"
                    aria-invalid={bad}
                    className={`w-24 rounded border px-2 py-1 text-right text-sm tabular-nums ${bad ? 'border-semantic-error' : 'border-border-light'}`}
                    value={r.qty}
                    onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {invalid && (
        <p className="mt-2 text-xs text-semantic-error">
          {t('sales.convert.too_much', { defaultValue: 'A quantity is above what remains on the line.' })}
        </p>
      )}
    </WideModal>
  );
}
