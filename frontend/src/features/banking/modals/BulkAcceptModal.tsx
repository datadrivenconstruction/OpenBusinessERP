import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCheck } from 'lucide-react';
import { Button, WideModal, WideModalField, WideModalSection } from '@/shared/ui';
import { getErrorMessage } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { bankingApi, type BulkAcceptResult } from '../api';
import { inputCls } from './AccountFormModal';

const THRESHOLDS = [0.95, 0.9, 0.85, 0.8, 0.75];

export function BulkAcceptModal({ accountId, onClose }: { accountId?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [min, setMin] = useState(0.85);
  const [result, setResult] = useState<BulkAcceptResult | null>(null);
  const run = useMutation({
    mutationFn: () => bankingApi.bulkAccept(min, accountId),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['banking'] });
      addToast({
        type: r.accepted.length ? 'success' : 'info',
        title: t('banking.bulk_done', { defaultValue: '{{n}} lines matched', n: r.accepted.length }),
      });
    },
    onError: (e) => addToast({ type: 'error', title: getErrorMessage(e) }),
  });
  return (
    <WideModal
      open
      onClose={onClose}
      busy={run.isPending}
      size="md"
      title={t('banking.bulk_title', { defaultValue: 'Accept confident matches' })}
      subtitle={t('banking.bulk_sub', {
        defaultValue: 'Confirms the top suggestion of every open line that scores at least the threshold, closes the line exactly and has no close runner-up.',
      })}
      footer={
        result ? (
          <Button size="sm" onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={onClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
            <Button size="sm" icon={<CheckCheck size={14} />} loading={run.isPending} onClick={() => run.mutate()}>
              {t('banking.bulk_run', { defaultValue: 'Accept matches' })}
            </Button>
          </>
        )
      }
    >
      {!result ? (
        <WideModalSection>
          <WideModalField
            label={t('banking.bulk_threshold', { defaultValue: 'Minimum confidence' })}
            hint={t('banking.bulk_threshold_hint', { defaultValue: 'Every match can be undone afterwards from the line.' })}
          >
            <select className={inputCls} value={min} onChange={(e) => setMin(Number(e.target.value))}>
              {THRESHOLDS.map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
            </select>
          </WideModalField>
        </WideModalSection>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-content-primary">
            {t('banking.bulk_result', {
              defaultValue: '{{n}} lines matched, {{s}} left for review.',
              n: result.accepted.length,
              s: result.skipped,
            })}
          </p>
          {result.errors.length > 0 && (
            <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-xs text-semantic-error">
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </WideModal>
  );
}
