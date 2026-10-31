import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Save } from 'lucide-react';
import { apiGet, apiPut, downloadWithAuth } from '@/shared/lib/api';
import { Button } from '@/shared/ui/Button';
import { ComplianceDisclaimer } from '@/shared/ui/ComplianceDisclaimer';
import { EXPORT_FORMATS, exportFilename, exportUrl, type ExportFormat } from './api';
import { Field, inputCls } from './ui';

export interface ExportSettings {
  berater_nr: number;
  mandant_nr: number;
  sachkontenlaenge: number;
  skr: string;
}

const FORMAT_LABEL: Record<ExportFormat, string> = {
  datev: 'DATEV Buchungsstapel (EXTF CSV)',
  'datev-contacts': 'DATEV Debitoren/Kreditoren (EXTF CSV)',
  saft: 'SAF-T Financial 2.0 (OECD XML)',
};

/** Accountant exports for the selected period; DATEV identifiers are stored server-side. */
export function ExportPanel({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [fmt, setFmt] = useState<ExportFormat>('datev');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const settings = useQuery({
    queryKey: ['gl', 'export-settings'],
    queryFn: () => apiGet<ExportSettings>('/v1/gl/export/settings/'),
    retry: false,
  });
  const [draft, setDraft] = useState<ExportSettings | null>(null);
  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: (b: ExportSettings) => apiPut<ExportSettings>('/v1/gl/export/settings/', b),
    onSuccess: (d) => qc.setQueryData(['gl', 'export-settings'], d),
  });

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      await downloadWithAuth(exportUrl(fmt, from, to), exportFilename(fmt, from, to));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const num = (k: keyof ExportSettings) => (
    <input
      type="number"
      className={inputCls}
      value={draft?.[k] ?? ''}
      onChange={(e) => draft && setDraft({ ...draft, [k]: Number(e.target.value) })}
    />
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border-light bg-surface-elevated p-4 shadow-xs">
        <div className="flex flex-wrap items-end gap-4">
          <Field label={t('accounting.export_format', { defaultValue: 'Format' })}>
            <select className={inputCls} value={fmt} onChange={(e) => setFmt(e.target.value as ExportFormat)}>
              {EXPORT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {t(`accounting.export_fmt_${f.replace('-', '_')}`, { defaultValue: FORMAT_LABEL[f] })}
                </option>
              ))}
            </select>
          </Field>
          <Button size="sm" icon={<Download size={14} />} disabled={busy || !from || !to} onClick={download}>
            {t('accounting.export_download', { defaultValue: 'Download' })}
          </Button>
        </div>
        <p className="mt-2 text-xs text-content-tertiary">
          {t('accounting.export_period_hint', {
            defaultValue: 'Exports posted entries from {{from}} to {{to}}. Master data exports ignore the period.',
            from,
            to,
          })}
        </p>
        {error && <p className="mt-2 text-sm text-semantic-error">{error}</p>}
      </div>

      {fmt !== 'saft' && draft && (
        <div className="rounded-xl border border-border-light bg-surface-elevated p-4 shadow-xs">
          <h3 className="mb-3 text-sm font-semibold text-content-primary">
            {t('accounting.datev_settings', { defaultValue: 'DATEV settings' })}
          </h3>
          <div className="flex flex-wrap items-end gap-4">
            <Field label={t('accounting.datev_berater', { defaultValue: 'Adviser number (Berater-Nr.)' })}>{num('berater_nr')}</Field>
            <Field label={t('accounting.datev_mandant', { defaultValue: 'Client number (Mandanten-Nr.)' })}>{num('mandant_nr')}</Field>
            <Field label={t('accounting.datev_length', { defaultValue: 'G/L account length' })}>{num('sachkontenlaenge')}</Field>
            <Button size="sm" variant="secondary" icon={<Save size={14} />} disabled={save.isPending} onClick={() => save.mutate(draft)}>
              {t('common.save', { defaultValue: 'Save' })}
            </Button>
          </div>
          <p className="mt-2 text-xs text-content-tertiary">
            {t('accounting.datev_limits', {
              defaultValue:
                'Receivables and payables are exported on the summary accounts (e.g. 1400/1600), not on personal accounts. VAT lines are folded into gross amounts: SKR03 automatic accounts (8400, 8300, 3400, 3300) get no tax key, other accounts get keys 2/3 (output VAT) or 8/9 (input VAT). Only the first 14 Buchungsstapel columns are written.',
            })}
          </p>
        </div>
      )}

      <div className="rounded-lg border border-semantic-warning/40 bg-semantic-warning/10 p-3 text-sm text-content-primary">
        {t('accounting.export_disclaimer', {
          defaultValue:
            'These files are not certified by DATEV or any tax authority. Have your tax adviser check every export before importing or filing it.',
        })}
      </div>
      <ComplianceDisclaimer />
    </div>
  );
}
