import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Mail } from 'lucide-react';
import { Button, WideModal } from '@/shared/ui';
import type { BulkResult } from '../api';

export function mailtoHref(d: { to: string; subject: string; body: string }): string {
  return `mailto:${encodeURIComponent(d.to)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
}

/** Payment reminders are drafts only: the user copies or opens them in their own mail client. */
export function ReminderDraftsModal({ result, onClose }: { result: BulkResult; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      setCopied(null);
    }
  };
  return (
    <WideModal
      open
      onClose={onClose}
      size="lg"
      title={t('sales.reminders.title', { defaultValue: 'Payment reminder drafts' })}
      subtitle={t('sales.reminders.subtitle', {
        defaultValue: '{{count}} drafts prepared. Nothing has been sent.',
        count: result.drafts.length,
      })}
      footer={<Button onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</Button>}
    >
      <div className="space-y-3">
        {result.drafts.length === 0 && (
          <p className="text-sm text-content-tertiary">{t('sales.reminders.none', { defaultValue: 'No reminders were needed for the selection.' })}</p>
        )}
        {result.drafts.map((d) => (
          <div key={d.id} className="rounded-lg border border-border-light p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-content-secondary">{d.number}</span>
              <span className="text-sm text-content-primary">{d.to || t('sales.reminders.no_email', { defaultValue: 'No e-mail on file' })}</span>
              <div className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={copied === d.id ? <Check size={14} /> : <Copy size={14} />}
                  onClick={() => copy(d.id, `${d.subject}\n\n${d.body}`)}
                >
                  {copied === d.id ? t('common.copied', { defaultValue: 'Copied' }) : t('common.copy', { defaultValue: 'Copy' })}
                </Button>
                {d.to && (
                  <a href={mailtoHref(d)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-oe-blue hover:bg-surface-secondary">
                    <Mail size={14} />
                    {t('sales.reminders.open_mail', { defaultValue: 'Open in mail' })}
                  </a>
                )}
              </div>
            </div>
            <p className="text-sm font-medium text-content-primary">{d.subject}</p>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-xs text-content-secondary">{d.body}</pre>
          </div>
        ))}
        {result.skipped.length > 0 && (
          <div className="rounded-lg bg-surface-secondary p-3 text-xs text-content-secondary">
            <p className="mb-1 font-medium">
              {t('sales.bulk.skipped', { defaultValue: '{{count}} skipped', count: result.skipped.length })}
            </p>
            <ul className="list-disc pl-5">
              {result.skipped.map((s) => (
                <li key={s.id}>{s.reason}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </WideModal>
  );
}
