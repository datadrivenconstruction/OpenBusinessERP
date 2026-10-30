/**
 * PDF download, the "Send by email" dialog with a preview, the invoice data
 * check and the send history of one sales document. Nothing is ever sent
 * without the user pressing Send in the dialog.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Download, Mail, XCircle } from 'lucide-react';
import { triggerDownload } from '@/shared/lib/api';
import { Button } from '@/shared/ui/Button';
import { WideModal } from '@/shared/ui/WideModal';
import { fetchSalesPdf, kindPath, salesApi, type SalesDoc, type SendBody } from './api';
import { formatDateValue, fmtList } from '@/shared/lib/formatters';

const input =
  'w-full rounded border border-border-light bg-surface-primary px-2 py-1 text-sm text-content-primary focus:border-border focus:outline-none';

/** Split a comma/semicolon separated address list. */
export function splitAddresses(raw: string): string[] {
  return raw
    .split(/[;,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function SalesDocumentOutput({ doc }: { doc: SalesDoc }) {
  const { t } = useTranslation();
  const kind = kindPath(doc.kind);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isInvoice = doc.kind === 'invoice' || doc.kind === 'credit_note';
  const check = useQuery({
    queryKey: ['sales', kind, doc.id, 'check', doc.status, doc.number],
    queryFn: () => salesApi.check(kind, doc.id),
    enabled: isInvoice,
    retry: false,
  });
  const history = useQuery({
    queryKey: ['sales', kind, doc.id, 'sends'],
    queryFn: () => salesApi.sends(kind, doc.id),
    retry: false,
  });

  const download = async () => {
    setErr(null);
    try {
      triggerDownload(await fetchSalesPdf(kind, doc.id), `${doc.kind}-${doc.number}.pdf`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="rounded-xl border border-border-light bg-surface-elevated shadow-xs p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={download}>
          <Download className="mr-1 h-4 w-4" />
          {t('sales.download_pdf', { defaultValue: 'Download PDF' })}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Mail className="mr-1 h-4 w-4" />
          {t('sales.send_email', { defaultValue: 'Send by email' })}
        </Button>
        {err && <span className="text-sm text-content-secondary">{err}</span>}
      </div>

      {isInvoice && check.data && (
        <div className="mt-3 text-sm" data-testid="invoice-check">
          {check.data.length === 0 ? (
            <p className="flex items-center gap-1 text-content-secondary">
              <CheckCircle2 className="h-4 w-4" />
              {t('sales.check_ok', { defaultValue: 'Check found no missing invoice data.' })}
            </p>
          ) : (
            <div className="rounded border border-border-light bg-surface-secondary p-2">
              <p className="mb-1 flex items-center gap-1 font-medium text-content-primary">
                <AlertTriangle className="h-4 w-4" />
                {t('sales.check_missing', { defaultValue: 'Please check - invoice data that looks missing:' })}
              </p>
              <ul className="list-disc pl-6 text-content-secondary">
                {check.data.map((i) => (
                  <li key={i.field}>{i.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {history.data && history.data.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-medium text-content-tertiary">
            {t('sales.send_history', { defaultValue: 'Send history' })}
          </h3>
          <ol className="border-l border-border-light pl-3 text-sm" data-testid="send-history">
            {history.data.map((h) => (
              <li key={h.id} className="mb-1 flex items-start gap-1">
                {h.status === 'sent' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-content-secondary" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-content-secondary" />
                )}
                <span className="text-content-secondary">
                  {formatDateValue(h.sent_at, { dateStyle: 'medium', timeStyle: 'short' })} · {h.to_addr}
                  {h.cc.length > 0 && ` (cc ${fmtList(h.cc)})`} ·{' '}
                  {t(`sales.send_status_${h.status}`, { defaultValue: h.status })}
                  {h.backend && h.backend !== 'smtp' && ` · ${h.backend}`}
                  {h.detail && ` · ${h.detail}`}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {open && <SendDialog doc={doc} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function SendDialog({ doc, onClose }: { doc: SalesDoc; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const kind = kindPath(doc.kind);
  const draft = useQuery({
    queryKey: ['sales', kind, doc.id, 'email-draft'],
    queryFn: () => salesApi.emailDraft(kind, doc.id),
    retry: false,
  });
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!draft.data) return;
    setTo(draft.data.to);
    setCc(draft.data.cc.join(', '));
    setSubject(draft.data.subject);
    setBody(draft.data.body);
  }, [draft.data]);

  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    fetchSalesPdf(kind, doc.id)
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [kind, doc.id]);

  const send = useMutation({
    mutationFn: (b: SendBody) => salesApi.send(kind, doc.id, b),
    onSuccess: (log) => {
      qc.invalidateQueries({ queryKey: ['sales', kind, doc.id, 'sends'] });
      if (log.status === 'sent') onClose();
      else setErr(log.detail || t('sales.send_failed', { defaultValue: 'Sending failed' }));
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const submit = () => {
    setErr(null);
    send.mutate({ to: to.trim(), cc: splitAddresses(cc), subject, body });
  };

  return (
    <WideModal
      open
      onClose={onClose}
      size="xl"
      busy={send.isPending}
      title={t('sales.send_title', { defaultValue: 'Send {{number}} by email', number: doc.number })}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button size="sm" onClick={submit} disabled={send.isPending || !to.trim() || !subject.trim()}>
            <Mail className="mr-1 h-4 w-4" />
            {t('sales.send', { defaultValue: 'Send' })}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-xs text-content-tertiary">
            {t('sales.email_to', { defaultValue: 'To' })}
            <input className={input} type="email" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="text-xs text-content-tertiary">
            {t('sales.email_cc', { defaultValue: 'Cc (comma separated)' })}
            <input className={input} value={cc} onChange={(e) => setCc(e.target.value)} />
          </label>
          <label className="text-xs text-content-tertiary">
            {t('sales.email_subject', { defaultValue: 'Subject' })}
            <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="text-xs text-content-tertiary">
            {t('sales.email_body', { defaultValue: 'Message' })}
            <textarea className={`${input} min-h-[180px]`} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <p className="text-xs text-content-tertiary">
            {t('sales.email_attachment', { defaultValue: 'Attachment: {{file}}', file: draft.data?.filename ?? '' })}
          </p>
          {draft.data && draft.data.issues.length > 0 && (
            <p className="flex items-center gap-1 text-xs text-content-secondary">
              <AlertTriangle className="h-4 w-4" />
              {t('sales.email_check_warning', {
                defaultValue: '{{count}} invoice data check(s) open - see the document page.',
                count: draft.data.issues.length,
              })}
            </p>
          )}
          {err && <p className="text-sm text-content-primary">{err}</p>}
        </div>
        <div className="min-h-[420px] rounded border border-border-light bg-surface-secondary">
          {preview ? (
            <iframe title={t('sales.pdf_preview', { defaultValue: 'PDF preview' })} src={preview} className="h-[520px] w-full" />
          ) : (
            <p className="p-4 text-sm text-content-tertiary">{t('common.loading', { defaultValue: 'Loading…' })}</p>
          )}
        </div>
      </div>
    </WideModal>
  );
}
