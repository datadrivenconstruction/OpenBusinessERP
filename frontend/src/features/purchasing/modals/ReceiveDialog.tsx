import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { WideModal } from '@/shared/ui/WideModal';
import { Button } from '@/shared/ui/Button';
import { getErrorMessage } from '@/shared/lib/api';
import { purchasingApi, type PurchasingLine, type Receipt } from '../api';
import { usePurchasingDoc, useInvalidatePurchasing } from '../hooks';
import { cellInput } from '../components/common';

export function remainingQty(l: PurchasingLine): number {
  if (l.remaining_qty != null) return Math.max(0, Number(l.remaining_qty) || 0);
  return Math.max(0, (Number(l.qty) || 0) - (Number(l.qty_received) || 0));
}

/** PO -> goods receipt with per-line partial quantities, prefilled with what is still open. */
export function ReceiveDialog({ orderId, onClose, onDone }: { orderId: string | null; onClose: () => void; onDone?: (r: Receipt) => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidatePurchasing();
  const { data: doc } = usePurchasingDoc('orders', orderId ?? undefined);
  const lines = useMemo(() => (doc?.lines ?? []).filter((l) => l.id && remainingQty(l) > 0), [doc]);
  const [qty, setQty] = useState<Record<string, string>>({});
  useEffect(() => setQty(Object.fromEntries(lines.map((l) => [l.id!, String(remainingQty(l))]))), [lines]);
  const errors = Object.fromEntries(
    lines.map((l) => {
      const v = Number(qty[l.id!] ?? 0);
      return [l.id!, Number.isNaN(v) || v < 0 ? 'invalid' : v > remainingQty(l) ? 'over' : ''];
    }),
  );
  const payload = lines.map((l) => ({ order_line_id: l.id!, qty: qty[l.id!] || '0' })).filter((l) => Number(l.qty) > 0);
  const hasErr = Object.values(errors).some(Boolean);
  const m = useMutation({
    mutationFn: () => purchasingApi.receive(orderId!, payload),
    onSuccess: (r) => {
      void invalidate();
      onDone?.(r);
      onClose();
    },
  });

  return (
    <WideModal
onSubmit={() => { if (!hasErr && payload.length > 0 && !m.isPending) m.mutate(); }}
      open={!!orderId}
      onClose={onClose}
      busy={m.isPending}
      size="lg"
      title={t('purchasing.receive_title', { defaultValue: 'Receive goods' })}
      subtitle={doc ? `${doc.number} · ${doc.supplier_name}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => setQty(Object.fromEntries(lines.map((l) => [l.id!, String(remainingQty(l))])))}>
            {t('purchasing.receive_all', { defaultValue: 'Receive all open' })}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button variant="primary" loading={m.isPending} disabled={hasErr || payload.length === 0} onClick={() => m.mutate()}>
            {t('purchasing.receive_confirm', { defaultValue: 'Post receipt' })}
          </Button>
        </>
      }
    >
      {lines.length === 0 ? (
        <p className="text-sm text-content-tertiary">
          {doc ? t('purchasing.receive_nothing', { defaultValue: 'Everything on this order has been received.' }) : '…'}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-content-tertiary">
            <tr>
              <th className="py-1.5">{t('purchasing.description', { defaultValue: 'Description' })}</th>
              <th className="w-20 py-1.5 text-right">{t('purchasing.qty', { defaultValue: 'Qty' })}</th>
              <th className="w-24 py-1.5 text-right">{t('purchasing.received', { defaultValue: 'Received' })}</th>
              <th className="w-24 py-1.5 text-right">{t('purchasing.remaining', { defaultValue: 'Remaining' })}</th>
              <th className="w-28 py-1.5 text-right">{t('purchasing.receive_now', { defaultValue: 'Receive now' })}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-border-light">
                <td className="py-1.5">
                  <span className="mr-1 font-mono text-xs text-content-tertiary">{l.sku}</span>
                  {l.description}
                </td>
                <td className="text-right tabular-nums">{Number(l.qty)}</td>
                <td className="text-right tabular-nums text-content-secondary">{Number(l.qty_received ?? 0)}</td>
                <td className="text-right tabular-nums">{remainingQty(l)}</td>
                <td className="py-1 pl-2">
                  <input
                    className={`${cellInput} text-right tabular-nums ${errors[l.id!] ? 'border-semantic-error' : ''}`}
                    inputMode="decimal"
                    aria-invalid={!!errors[l.id!]}
                    aria-label={t('purchasing.receive_now', { defaultValue: 'Receive now' })}
                    value={qty[l.id!] ?? ''}
                    onChange={(e) => setQty((q) => ({ ...q, [l.id!]: e.target.value }))}
                  />
                  {errors[l.id!] === 'over' && (
                    <p className="mt-0.5 text-right text-2xs text-semantic-error">
                      {t('purchasing.receive_over', { defaultValue: 'More than remaining' })}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {m.error && <p className="mt-3 text-sm text-semantic-error">{getErrorMessage(m.error)}</p>}
    </WideModal>
  );
}
