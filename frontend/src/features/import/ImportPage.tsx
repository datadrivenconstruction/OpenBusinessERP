import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Download, FileUp, RotateCcw, Save } from 'lucide-react';
import { Badge, Breadcrumb, Button, Card, DismissibleInfo, ModuleGuideButton } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { importGuide } from './importGuide';
import { triggerDownload } from '@/shared/lib/api';
import {
  importApi,
  type ImportJob,
  type ImportOptions,
  type ImportSummary,
  type Mapping,
  type TargetKey,
  type ValidationResult,
} from './api';
import { applyPreset, errorsToCsv, missingAmount, missingRequired, setColumn } from './mapping';
import { formatDateValue, fmtList } from '@/shared/lib/formatters';

const STEPS = ['upload', 'map', 'validate', 'import', 'done'] as const;
const STEP_LABEL: Record<(typeof STEPS)[number], string> = {
  upload: 'Upload', map: 'Map columns', validate: 'Validate', import: 'Import', done: 'Done',
};
const TARGET_HINT: Record<TargetKey, string> = {
  customers: 'Matched by customer number, e-mail or VAT ID; existing contacts are updated.',
  suppliers: 'Matched by supplier number, e-mail or VAT ID; existing contacts are updated.',
  items: 'Matched by SKU; existing items are updated.',
  opening_balances: 'A trial balance becomes one balanced opening journal entry.',
  open_invoices: 'Unpaid customer invoices as opening receivables (no new ledger posting).',
  open_bills: 'Unpaid supplier bills as opening payables (no new ledger posting).',
};
const card = 'rounded-xl border border-border-light bg-surface-elevated p-4';
const control =
  'h-9 rounded-lg border border-border bg-surface-primary px-3 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function Counts({ s }: { s: ImportSummary }) {
  const { t } = useTranslation();
  const items: [string, number | undefined, string][] = [
    [t('import.count_create', { defaultValue: 'New' }), s.create, 'text-semantic-success'],
    [t('import.count_update', { defaultValue: 'Updated' }), s.update, 'text-oe-blue'],
    [t('import.count_skip', { defaultValue: 'Skipped' }), s.skip, 'text-content-secondary'],
    [t('import.count_error', { defaultValue: 'With errors' }), s.error, 'text-semantic-error'],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, n, cls]) => (
        <div key={label} className="rounded-md border border-border-light px-3 py-2">
          <div className="text-xs text-content-secondary">{label}</div>
          <div className={`text-lg font-semibold tabular-nums ${cls}`}>{n ?? 0}</div>
        </div>
      ))}
    </div>
  );
}

export function ImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [target, setTarget] = useState<TargetKey>((params.get('target') as TargetKey) || 'customers');
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [options, setOptions] = useState<ImportOptions>({ opening_date: `${new Date().getFullYear()}-01-01` });
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');

  const targets = useQuery({ queryKey: ['data-import', 'targets'], queryFn: importApi.targets, retry: false });
  const presets = useQuery({
    queryKey: ['data-import', 'presets', target],
    queryFn: () => importApi.presets(target),
    enabled: step === 1,
    retry: false,
  });
  const jobs = useQuery({ queryKey: ['data-import', 'jobs'], queryFn: importApi.jobs, retry: false });
  const spec = targets.data?.find((x) => x.key === target);
  const fields = spec?.fields ?? [];

  const reset = () => {
    setStep(0); setFile(null); setJob(null); setMapping({}); setValidation(null); setResult(null); setError(null);
  };

  const uploader = useMutation({
    mutationFn: () => importApi.upload(target, file as File),
    onSuccess: (j) => { setJob(j); setMapping(j.mapping); setError(null); setStep(1); },
    onError: (e) => setError(errMsg(e)),
  });
  const validator = useMutation({
    mutationFn: () => importApi.validate((job as ImportJob).id, mapping, options),
    onSuccess: (v) => { setValidation(v); setError(null); setStep(2); },
    onError: (e) => setError(errMsg(e)),
  });
  const committer = useMutation({
    mutationFn: () => importApi.commit((job as ImportJob).id, mapping, options),
    onMutate: () => setStep(3),
    onSuccess: (r) => {
      setResult(r.summary); setError(null); setStep(4);
      qc.invalidateQueries({ queryKey: ['data-import', 'jobs'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (e) => { setError(errMsg(e)); setStep(2); },
  });
  const undoer = useMutation({
    mutationFn: (id: string) => importApi.undo(id),
    onSuccess: (r) => {
      setError(null);
      setResult((s) => (s ? { ...s, undone_removed: r.removed, undone_kept_updates: r.kept_updates } : s));
      qc.invalidateQueries({ queryKey: ['data-import', 'jobs'] });
    },
    onError: (e) => setError(errMsg(e)),
  });
  const presetSaver = useMutation({
    mutationFn: () => importApi.savePreset(target, presetName.trim(), mapping),
    onSuccess: () => { setPresetName(''); qc.invalidateQueries({ queryKey: ['data-import', 'presets', target] }); },
    onError: (e) => setError(errMsg(e)),
  });

  const missing = missingRequired(fields, mapping);
  const needsAmount = missingAmount(target, mapping);
  const sample = (i: number) => (job?.preview ?? []).slice(0, 3).map((r) => r[i]).filter(Boolean).join(' · ');
  const allErrors = useMemo(
    () => [
      ...(validation?.summary.file_errors ?? []).map((m) => ({ row: 0, message: m })),
      ...(validation?.errors ?? []),
    ],
    [validation],
  );
  const s = validation?.summary;
  const blocked = Boolean(s?.file_errors?.length) || (Boolean(s?.error) && (target === 'opening_balances' || !options.skip_invalid));

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: t('import.title', { defaultValue: 'Import data' }) }]} />
      <PageHeader
        srTitle={t('import.title', { defaultValue: 'Import data' })}
        subtitle={t('import.subtitle', { defaultValue: 'Bring customers, suppliers, products, opening balances and open invoices over from a CSV or Excel file.' })}
        actions={
          <>
            <ModuleGuideButton content={importGuide} onCta={reset} />
            {step > 0 && step < 4 ? (
              <Button variant="secondary" size="sm" icon={<RotateCcw size={14} />} onClick={reset}>
                {t('import.start_over', { defaultValue: 'Start over' })}
              </Button>
            ) : (
              <Button variant="primary" size="sm" icon={<FileUp size={14} />} onClick={reset}>
                {t('import.new_import', { defaultValue: 'New import' })}
              </Button>
            )}
          </>
        }
      />

      <DismissibleInfo
        storageKey="import"
        title={t('import.intro_title', { defaultValue: 'Move your data in safely' })}
        links={[
          { label: t('import.intro_link_contacts', { defaultValue: 'Contacts' }), onClick: () => navigate('/contacts') },
          { label: t('import.intro_link_accounting', { defaultValue: 'Accounting' }), onClick: () => navigate('/accounting') },
          { label: t('import.intro_link_sales', { defaultValue: 'Sales' }), onClick: () => navigate('/sales') },
        ]}
      >
        {t('import.intro_body', {
          defaultValue:
            'Upload a CSV or Excel file, map its columns, and review a dry run before anything is saved. Every import is logged and can be undone.',
        })}
      </DismissibleInfo>

      {step === 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            [t('import.kpi_imports', { defaultValue: 'Imports' }), (jobs.data ?? []).filter((j) => j.status === 'committed' || j.status === 'undone').length],
            [t('import.kpi_created', { defaultValue: 'Records created' }), (jobs.data ?? []).filter((j) => j.status === 'committed').reduce((a, j) => a + (j.summary.create ?? 0), 0)],
            [t('import.kpi_updated', { defaultValue: 'Records updated' }), (jobs.data ?? []).filter((j) => j.status === 'committed').reduce((a, j) => a + (j.summary.update ?? 0), 0)],
            [t('import.kpi_undone', { defaultValue: 'Undone' }), (jobs.data ?? []).filter((j) => j.status === 'undone').length],
          ] as [string, number][]).map(([label, n]) => (
            <div key={label} className="rounded-xl border border-border-light bg-surface-elevated px-4 py-3">
              <div className="text-xs text-content-secondary">{label}</div>
              <div className="text-xl font-semibold tabular-nums text-content-primary">{n}</div>
            </div>
          ))}
        </div>
      )}

      <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label={t('import.steps', { defaultValue: 'Steps' })}>
        {STEPS.map((k, i) => (
          <li key={k} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                i < step ? 'bg-oe-blue text-white' : i === step ? 'border-2 border-oe-blue text-oe-blue' : 'border border-border-light text-content-tertiary'
              }`}
              aria-current={i === step ? 'step' : undefined}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={i === step ? 'font-medium text-content-primary' : 'text-content-secondary'}>
              {t(`import.step_${k}`, { defaultValue: STEP_LABEL[k] })}
            </span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border-light" />}
          </li>
        ))}
      </ol>

      {error && (
        <div role="alert" className="rounded-lg border border-semantic-error/30 bg-semantic-error/5 px-3 py-2 text-sm text-semantic-error">
          {error}
        </div>
      )}

      {step === 0 && (
        <div className="space-y-4">
          <div className={card}>
            <h2 className="mb-3 text-sm font-semibold text-content-primary">{t('import.what', { defaultValue: 'What are you importing?' })}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {(targets.data ?? []).map((x) => (
                <label
                  key={x.key}
                  className={`cursor-pointer rounded-md border px-3 py-2 ${x.key === target ? 'border-oe-blue bg-oe-blue/5' : 'border-border-light hover:bg-surface-secondary'}`}
                >
                  <input type="radio" name="target" className="sr-only" checked={x.key === target} onChange={() => setTarget(x.key)} />
                  <div className="text-sm font-medium text-content-primary">{t(`import.target_${x.key}`, { defaultValue: x.label })}</div>
                  <div className="text-xs text-content-secondary">{t(`import.hint_${x.key}`, { defaultValue: TARGET_HINT[x.key] })}</div>
                </label>
              ))}
            </div>
          </div>
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex flex-1 cursor-pointer items-center gap-3 rounded-md border border-dashed border-border px-4 py-6 hover:bg-surface-secondary">
                <FileUp className="h-6 w-6 text-content-tertiary" />
                <span className="text-sm text-content-secondary">
                  {file ? file.name : t('import.choose_file', { defaultValue: 'Choose a CSV or XLSX file (UTF-8 or Windows-1252, comma or semicolon)' })}
                </span>
                <input
                  type="file"
                  accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <div className="flex flex-col gap-2">
                <Button size="sm" variant="secondary" onClick={() => importApi.template(target).catch((e) => setError(errMsg(e)))}>
                  <Download className="mr-1 h-4 w-4" />
                  {t('import.template', { defaultValue: 'Sample template' })}
                </Button>
                <Button variant="primary" size="sm" disabled={!file || uploader.isPending} onClick={() => uploader.mutate()}>
                  {uploader.isPending ? t('import.reading', { defaultValue: 'Reading…' }) : t('import.next', { defaultValue: 'Next' })}
                </Button>
              </div>
            </div>
            <p className="mt-3 text-xs text-content-tertiary">
              {t('import.legal_note', { defaultValue: 'Column presets for files exported from other products are our own conventions. Product names are trademarks of their respective owners; there is no affiliation.' })}
            </p>
          </div>
        </div>
      )}

      {step === 1 && job && (
        <div className={card}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-content-secondary">
              {job.filename} · {t('import.rows', { defaultValue: '{{n}} rows', n: job.row_count })} · {job.encoding}
              {job.delimiter ? ` · "${job.delimiter === '\t' ? 'TAB' : job.delimiter}"` : ''}
            </div>
            <select
              className={control}
              aria-label={t('import.preset', { defaultValue: 'Mapping preset' })}
              value=""
              onChange={(e) => {
                const p = presets.data?.find((x) => (x.id ?? x.name) === e.target.value);
                if (p) setMapping(applyPreset(job.headers, p.mapping, p.builtin ? mapping : {}));
              }}
            >
              <option value="">{t('import.apply_preset', { defaultValue: 'Apply a preset…' })}</option>
              {(presets.data ?? []).map((p) => (
                <option key={p.id ?? p.name} value={p.id ?? p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-secondary text-content-tertiary text-xs uppercase tracking-wide text-left">
                  <th className="px-4 py-2.5 font-medium">{t('import.col_file', { defaultValue: 'Column in your file' })}</th>
                  <th className="px-4 py-2.5 font-medium">{t('import.col_sample', { defaultValue: 'Sample values' })}</th>
                  <th className="px-4 py-2.5 font-medium">{t('import.col_field', { defaultValue: 'Import as' })}</th>
                  <th className="px-4 py-2.5 font-medium">{t('import.col_confidence', { defaultValue: 'Match' })}</th>
                </tr>
              </thead>
              <tbody>
                {job.headers.map((h, i) => (
                  <tr key={h} className="border-t border-border-light">
                    <td className="px-4 py-2 font-medium text-content-primary">{h}</td>
                    <td className="max-w-xs truncate px-4 py-2 text-content-secondary">{sample(i)}</td>
                    <td className="px-4 py-2">
                      <select className={`${control} w-full`} value={mapping[h] ?? ''} onChange={(e) => setMapping(setColumn(mapping, h, e.target.value))}>
                        <option value="">{t('import.ignore', { defaultValue: '— ignore —' })}</option>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      {mapping[h] && job.mapping[h] === mapping[h] && job.summary.confidence?.[h] !== undefined ? (
                        <Badge variant={job.summary.confidence[h] >= 0.95 ? 'success' : 'warning'}>
                          {Math.round(job.summary.confidence[h] * 100)}%
                        </Badge>
                      ) : mapping[h] ? (
                        <span className="text-xs text-content-tertiary">{t('import.manual', { defaultValue: 'manual' })}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {['customers', 'suppliers', 'items'].includes(target) && (
            <label className="mt-4 flex flex-wrap items-center gap-2 text-sm text-content-primary">
              {t('import.existing_mode', { defaultValue: 'If a record already exists' })}
              <select className={control} value={options.existing ?? 'update'} onChange={(e) => setOptions({ ...options, existing: e.target.value as 'update' | 'skip' })}>
                <option value="update">{t('import.existing_update', { defaultValue: 'Update it' })}</option>
                <option value="skip">{t('import.existing_skip', { defaultValue: 'Skip it (only add new)' })}</option>
              </select>
            </label>
          )}
          {target === 'opening_balances' && (
            <label className="mt-4 flex items-center gap-2 text-sm text-content-primary">
              {t('import.opening_date', { defaultValue: 'Opening date' })}
              <input type="date" className={control} value={options.opening_date ?? ''} onChange={(e) => setOptions({ ...options, opening_date: e.target.value })} />
            </label>
          )}
          {(missing.length > 0 || needsAmount) && (
            <p className="mt-3 text-sm text-semantic-warning">
              {t('import.missing', { defaultValue: 'Still to map:' })} {fmtList([...missing.map((f) => f.label), ...(needsAmount ? ['Debit/Credit or Balance'] : [])])}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input
                className={control}
                placeholder={t('import.preset_name', { defaultValue: 'Save mapping as…' })}
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
              <Button size="sm" variant="secondary" disabled={!presetName.trim() || presetSaver.isPending} onClick={() => presetSaver.mutate()}>
                <Save className="mr-1 h-4 w-4" />
                {t('import.save_preset', { defaultValue: 'Save' })}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setStep(0)}>{t('import.back', { defaultValue: 'Back' })}</Button>
              <Button variant="primary" size="sm" disabled={missing.length > 0 || needsAmount || validator.isPending} onClick={() => validator.mutate()}>
                {t('import.check', { defaultValue: 'Check data' })}
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && s && (
        <div className={`${card} space-y-4`}>
          <p className="text-sm text-content-secondary">
            {t('import.dry_run', { defaultValue: 'Dry run — nothing has been saved yet. This is what the import would do:' })}
          </p>
          <Counts s={s} />
          {allErrors.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-content-primary">
                  {t('import.problems', { defaultValue: 'Problems found ({{n}})', n: allErrors.length })}
                </h3>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => triggerDownload(new Blob([errorsToCsv(allErrors)], { type: 'text/csv;charset=utf-8' }), `import-errors-${target}.csv`)}
                >
                  <Download className="mr-1 h-4 w-4" />
                  {t('import.download_errors', { defaultValue: 'Download as CSV' })}
                </Button>
              </div>
              <div className="max-h-72 overflow-auto rounded-md border border-border-light">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-secondary text-left text-xs text-content-secondary">
                    <tr>
                      <th className="w-20 px-4 py-2.5 font-medium">{t('import.row', { defaultValue: 'Row' })}</th>
                      <th className="px-4 py-2.5 font-medium">{t('import.problem', { defaultValue: 'Problem' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allErrors.slice(0, 500).map((e, i) => (
                      <tr key={i} className="border-t border-border-light">
                        <td className="px-4 py-2 tabular-nums text-content-secondary">{e.row || '—'}</td>
                        <td className="px-4 py-2 text-content-primary">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {Boolean(s.error) && target !== 'opening_balances' && !s.file_errors?.length && (
            <label className="flex items-center gap-2 text-sm text-content-primary">
              <input type="checkbox" checked={Boolean(options.skip_invalid)} onChange={(e) => setOptions({ ...options, skip_invalid: e.target.checked })} />
              {t('import.skip_invalid', { defaultValue: 'Skip rows with errors and import the rest' })}
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setStep(1)}>{t('import.back', { defaultValue: 'Back' })}</Button>
            <Button variant="primary" size="sm" disabled={blocked || committer.isPending || !((s.create ?? 0) + (s.update ?? 0))} onClick={() => committer.mutate()}>
              {t('import.run', { defaultValue: 'Import {{n}} rows', n: (s.create ?? 0) + (s.update ?? 0) })}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className={`${card} text-sm text-content-secondary`}>{t('import.importing', { defaultValue: 'Importing… all rows are written in one transaction.' })}</div>
      )}

      {step === 4 && result && job && (
        <div className={`${card} space-y-4`}>
          <div className="flex items-center gap-2 text-content-primary">
            <Check className="h-5 w-5 text-semantic-success" />
            <span className="font-medium">{t('import.done', { defaultValue: 'Import finished' })}</span>
          </div>
          <Counts s={result} />
          {result.undone_removed !== undefined ? (
            <p className="text-sm text-content-secondary">
              {t('import.undone', {
                defaultValue: 'Undone: {{removed}} records removed. {{kept}} updated records keep their new values.',
                removed: result.undone_removed,
                kept: result.undone_kept_updates ?? 0,
              })}
            </p>
          ) : (
            <p className="text-sm text-content-secondary">
              {t('import.undo_hint', { defaultValue: 'Made a mistake? Undo removes every record this import created.' })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {result.undone_removed === undefined && (
              <Button size="sm" variant="secondary" disabled={undoer.isPending} onClick={() => undoer.mutate(job.id)}>
                <RotateCcw className="mr-1 h-4 w-4" />
                {t('import.undo', { defaultValue: 'Undo import' })}
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={reset}>{t('import.another', { defaultValue: 'Import another file' })}</Button>
          </div>
        </div>
      )}

      {jobs.isSuccess && (jobs.data?.length ?? 0) === 0 && step === 0 && (
        <div className="rounded-xl border border-dashed border-border-light px-4 py-6 text-center text-sm text-content-secondary">
          {t('import.log_empty', { defaultValue: 'No imports yet. Download a sample template above, fill it in and upload it. Each import appears here and can be undone.' })}
        </div>
      )}

      {(jobs.data?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-content-primary">{t('import.log', { defaultValue: 'Import log' })}</h2>
          <Card padding="none" className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {jobs.data!.slice(0, 20).map((j) => (
                  <tr key={j.id} className="border-t border-border-light first:border-t-0 hover:bg-surface-secondary">
                    <td className="px-4 py-2 text-content-secondary">{j.created_at ? formatDateValue(j.created_at, { dateStyle: 'medium', timeStyle: 'short' }) : ''}</td>
                    <td className="px-4 py-2 text-content-primary">{j.filename}</td>
                    <td className="px-4 py-2 text-content-secondary">{t(`import.target_${j.target}`, { defaultValue: j.target })}</td>
                    <td className="px-4 py-2 tabular-nums text-content-secondary">
                      +{j.summary.create ?? 0} / ~{j.summary.update ?? 0}
                    </td>
                    <td className="px-4 py-2"><Badge>{t(`import.status_${j.status}`, { defaultValue: j.status })}</Badge></td>
                    <td className="px-4 py-2 text-right">
                      {j.status === 'committed' && (
                        <Button size="sm" variant="ghost" disabled={undoer.isPending} onClick={() => undoer.mutate(j.id)}>
                          {t('import.undo', { defaultValue: 'Undo import' })}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
