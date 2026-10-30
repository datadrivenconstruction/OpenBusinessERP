import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, WideModal, WideModalField, WideModalSection } from '@/shared/ui';
import { getErrorMessage } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { bankingApi, type BankSettings } from '../api';
import { inputCls } from './AccountFormModal';

export function MatchSettingsModal({ settings, onClose }: { settings: BankSettings | undefined; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [cfg, setCfg] = useState({
    amount_tolerance: settings?.amount_tolerance ?? '',
    date_window_days: settings?.date_window_days != null ? String(settings.date_window_days) : '',
    writeoff_account_code: settings?.writeoff_account_code ?? '',
    writeoff_max: settings?.writeoff_max ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      bankingApi.saveSettings({
        amount_tolerance: cfg.amount_tolerance || null,
        date_window_days: cfg.date_window_days ? Number(cfg.date_window_days) : null,
        writeoff_account_code: cfg.writeoff_account_code || null,
        writeoff_max: cfg.writeoff_max || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['banking'] });
      addToast({ type: 'success', title: t('banking.settings_saved', { defaultValue: 'Matching settings saved' }) });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  const field = (k: keyof typeof cfg, decimal = true) => (
    <input
      className={inputCls}
      inputMode={decimal ? 'decimal' : 'numeric'}
      value={cfg[k]}
      onChange={(e) => setCfg({ ...cfg, [k]: e.target.value.replace(',', '.') })}
    />
  );
  return (
    <WideModal
      open
      onClose={onClose}
      busy={save.isPending}
      size="md"
      title={t('banking.settings_title', { defaultValue: 'Matching settings' })}
      subtitle={t('banking.settings_sub', { defaultValue: 'How strict suggestions are and how small differences get closed.' })}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button size="sm" loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
        </>
      }
    >
      <WideModalSection columns={2}>
        <WideModalField
          label={t('banking.tolerance', { defaultValue: 'Amount tolerance' })}
          hint={t('banking.tolerance_hint', { defaultValue: 'Differences up to this still count as a full match.' })}
        >
          {field('amount_tolerance')}
        </WideModalField>
        <WideModalField
          label={t('banking.date_window', { defaultValue: 'Date window (days)' })}
          hint={t('banking.date_window_hint', { defaultValue: 'Payments closer to the due date score higher.' })}
        >
          {field('date_window_days', false)}
        </WideModalField>
        <WideModalField
          label={t('banking.writeoff_account', { defaultValue: 'Write-off account' })}
          hint={t('banking.writeoff_account_hint', { defaultValue: 'Empty uses the chart default for other operating expenses.' })}
        >
          <input className={inputCls} value={cfg.writeoff_account_code} onChange={(e) => setCfg({ ...cfg, writeoff_account_code: e.target.value })} />
        </WideModalField>
        <WideModalField label={t('banking.writeoff_max', { defaultValue: 'Max write-off' })}>{field('writeoff_max')}</WideModalField>
      </WideModalSection>
      {error && <p className="mt-3 text-sm text-semantic-error">{error}</p>}
    </WideModal>
  );
}
