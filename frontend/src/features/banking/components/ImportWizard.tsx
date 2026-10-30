import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Check, FileUp, Upload } from 'lucide-react';
import { Button, Card } from '@/shared/ui';
import { getErrorMessage } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { bankingApi, type BankAccount, type CsvMapping, type StatementFormat } from '../api';
import { csvHeaders, csvSample, guessMapping, mappingReady } from '../logic';
import { inputCls } from '../modals/AccountFormModal';
import { ImportMapping } from './ImportMapping';
import { ImportPreviewView } from './ImportPreviewView';

type Step = 'file' | 'mapping' | 'preview' | 'done';

interface Props {
  accounts: BankAccount[];
  initialAccountId?: string;
  onReconcile: (accountId: string) => void;
}

export function ImportWizard({ accounts, initialAccountId, onReconcile }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [step, setStep] = useState<Step>('file');
  const [accountId, setAccountId] = useState(initialAccountId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<StatementFormat | ''>('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [sample, setSample] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<CsvMapping>({ date: '' });
  const [dragging, setDragging] = useState(false);
  const account = accounts.find((a) => a.id === (accountId || accounts[0]?.id));
  const isCsv = format === 'csv' || (!format && !!file && /\.(csv|txt)$/i.test(file.name));
  const fmt = (format || (isCsv ? 'csv' : undefined)) as StatementFormat | undefined;
  const map = isCsv ? mapping : undefined;

  useEffect(() => {
    if (initialAccountId) setAccountId(initialAccountId);
  }, [initialAccountId]);
  useEffect(() => {
    if (!file || !isCsv) return;
    file.slice(0, 16384).text().then((txt) => {
      const { delimiter, headers: h } = csvHeaders(txt.split(/\r?\n/)[0] ?? '');
      setHeaders(h);
      setSample(csvSample(txt, delimiter));
      setMapping({ ...guessMapping(h), delimiter });
    });
  }, [file, isCsv]);

  const preview = useMutation({
    mutationFn: () => bankingApi.previewImport(account!.id, file!, fmt, map),
    onSuccess: () => setStep('preview'),
  });
  const run = useMutation({
    mutationFn: () => bankingApi.importStatement(account!.id, file!, fmt, map),
    onSuccess: (r) => {
      setStep('done');
      qc.invalidateQueries({ queryKey: ['banking'] });
      addToast({ type: 'success', title: t('banking.import_done', { defaultValue: '{{n}} new lines imported, {{d}} already known and skipped.', n: r.imported_count, d: r.duplicate_count }) });
    },
  });
  const reset = () => {
    setStep('file');
    setFile(null);
    setHeaders([]);
    setSample([]);
    preview.reset();
    run.reset();
  };
  const steps: Step[] = isCsv ? ['file', 'mapping', 'preview', 'done'] : ['file', 'preview', 'done'];
  const stepLabel: Record<Step, string> = {
    file: t('banking.step_file', { defaultValue: 'File' }),
    mapping: t('banking.step_mapping', { defaultValue: 'Columns' }),
    preview: t('banking.step_preview', { defaultValue: 'Check' }),
    done: t('banking.step_done', { defaultValue: 'Imported' }),
  };
  const err = preview.error ?? run.error;
  const pickFile = (f: File | null) => { setFile(f); preview.reset(); };

  return (
    <div className="max-w-4xl space-y-4">
      <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label={t('banking.import_steps', { defaultValue: 'Import steps' })}>
        {steps.map((s, i) => {
          const pos = steps.indexOf(step);
          const done = i < pos;
          return (
            <li key={s} className="flex items-center gap-2">
              <span className={clsx('flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                s === step ? 'bg-oe-blue text-content-inverse' : done ? 'bg-semantic-success/15 text-semantic-success' : 'bg-surface-secondary text-content-tertiary')}>
                {done ? <Check size={12} /> : i + 1}
              </span>
              <span className={s === step ? 'font-medium text-content-primary' : 'text-content-tertiary'}>{stepLabel[s]}</span>
              {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
            </li>
          );
        })}
      </ol>

      <Card padding="md">
        {step === 'file' && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-content-secondary">{t('banking.import_into', { defaultValue: 'Import into' })}</span>
                <select className={inputCls} value={account?.id ?? ''} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-content-secondary">{t('banking.format', { defaultValue: 'Format' })}</span>
                <select className={inputCls} value={format} onChange={(e) => setFormat(e.target.value as StatementFormat | '')}>
                  <option value="">{t('banking.format_auto', { defaultValue: 'Detect format' })}</option>
                  <option value="camt053">camt.053</option>
                  <option value="camt054">camt.054</option>
                  <option value="mt940">MT940</option>
                  <option value="csv">CSV</option>
                </select>
              </label>
            </div>
            <label
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files?.[0] ?? null); }}
              className={clsx('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
                dragging ? 'border-oe-blue bg-oe-blue/5' : 'border-border hover:border-oe-blue/60')}
            >
              <FileUp size={26} className="text-oe-blue" />
              <span className="text-sm font-medium text-content-primary">
                {file ? file.name : t('banking.drop_file', { defaultValue: 'Drop a statement file here or click to choose' })}
              </span>
              <span className="text-xs text-content-tertiary">
                {file ? `${Math.ceil(file.size / 1024)} KB` : t('banking.drop_hint', { defaultValue: 'camt.053/054 XML, MT940 or CSV, up to 10 MB' })}
              </span>
              <input type="file" className="sr-only" accept=".xml,.sta,.mt940,.txt,.csv" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        )}
        {step === 'mapping' && <ImportMapping headers={headers} sample={sample} mapping={mapping} onChange={setMapping} />}
        {step === 'preview' && preview.data && account && <ImportPreviewView preview={preview.data} currency={account.currency} />}
        {step === 'done' && run.data && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-semantic-success/15 text-semantic-success"><Check size={20} /></span>
            <p className="text-sm text-content-primary">
              {t('banking.import_done', { defaultValue: '{{n}} new lines imported, {{d}} already known and skipped.', n: run.data.imported_count, d: run.data.duplicate_count })}
            </p>
          </div>
        )}
        {err && <p role="alert" className="mt-3 text-sm text-semantic-error">{getErrorMessage(err)}</p>}
      </Card>

      <div className="flex justify-between gap-2">
        {step !== 'file' && step !== 'done' ? (
          <Button variant="secondary" size="sm" icon={<ArrowLeft size={14} />} onClick={() => setStep(step === 'preview' && isCsv ? 'mapping' : 'file')}>
            {t('common.back', { defaultValue: 'Back' })}
          </Button>
        ) : <span />}
        {step === 'file' && (
          <Button size="sm" icon={<ArrowRight size={14} />} disabled={!file || !account} loading={preview.isPending}
            onClick={() => (isCsv ? setStep('mapping') : preview.mutate())}>
            {t('common.next', { defaultValue: 'Next' })}
          </Button>
        )}
        {step === 'mapping' && (
          <Button size="sm" icon={<ArrowRight size={14} />} disabled={!mappingReady(mapping)} loading={preview.isPending} onClick={() => preview.mutate()}>
            {t('banking.check_file', { defaultValue: 'Check file' })}
          </Button>
        )}
        {step === 'preview' && (
          <Button size="sm" icon={<Upload size={14} />} disabled={!preview.data?.new_count} loading={run.isPending} onClick={() => run.mutate()}>
            {t('banking.import_n', { defaultValue: 'Import {{n}} lines', n: preview.data?.new_count ?? 0 })}
          </Button>
        )}
        {step === 'done' && (
          <span className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={reset}>{t('banking.import_another', { defaultValue: 'Import another file' })}</Button>
            <Button size="sm" onClick={() => account && onReconcile(account.id)}>{t('banking.go_reconcile', { defaultValue: 'Reconcile now' })}</Button>
          </span>
        )}
      </div>
    </div>
  );
}
