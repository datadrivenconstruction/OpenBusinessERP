import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Copy, Mail, X } from 'lucide-react';
import { Button } from '@/shared/ui';
import { useToastStore } from '@/stores/useToastStore';
import { getErrorMessage } from '@/shared/lib/api';
import { appointmentsApi } from '../api';
import { mailtoHref } from '../scheduling';

const inputCls =
  'w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';
const labelCls = 'block text-xs font-medium text-content-secondary mb-1';

interface Props {
  reminderId: string;
  onClose: () => void;
}

/**
 * Review a reminder draft and send it from your own mail app. The module never
 * sends reminders itself; staff mark a draft as sent once they have sent it.
 */
export function ReminderDraftModal({ reminderId, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const draft = useQuery({ queryKey: ['appointments', 'reminder-draft', reminderId], queryFn: () => appointmentsApi.reminderDraft(reminderId), retry: false });
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => {
    if (draft.data) {
      setSubject(draft.data.subject);
      setBody(draft.data.body);
    }
  }, [draft.data]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const mark = useMutation({
    mutationFn: (s: 'sent' | 'skipped') => appointmentsApi.markReminder(reminderId, s),
    onSuccess: (_r, s) => {
      qc.invalidateQueries({ queryKey: ['appointments', 'reminders'] });
      addToast({
        type: 'success',
        title: s === 'sent'
          ? t('appointments.reminder_marked_sent', { defaultValue: 'Reminder marked as sent' })
          : t('appointments.reminder_skipped', { defaultValue: 'Reminder skipped' }),
      });
      onClose();
    },
    onError: (e) => addToast({ type: 'error', title: getErrorMessage(e) }),
  });
  const open = draft.data && ['queued', 'draft'].includes(draft.data.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-draft-title"
        className="w-full max-w-lg rounded-xl bg-surface-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-light px-5 py-3">
          <h2 id="reminder-draft-title" className="text-base font-semibold">{t('appointments.reminder_draft', { defaultValue: 'Reminder draft' })}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })}><X size={18} /></button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {t('appointments.reminder_manual_hint', { defaultValue: 'Nothing is sent automatically. Open the draft in your mail app or copy it, send it yourself, then mark it as sent.' })}
          </p>
          {draft.isLoading && <p className="text-sm text-content-secondary">…</p>}
          {draft.isError && <p className="text-sm text-semantic-error" role="alert">{getErrorMessage(draft.error)}</p>}
          {draft.data && (
            <>
              <div>
                <span className={labelCls}>{t('appointments.recipient', { defaultValue: 'To' })}</span>
                <p className="text-sm font-medium">{draft.data.client_name} &lt;{draft.data.recipient}&gt;</p>
              </div>
              <div>
                <label className={labelCls} htmlFor="rem-subject">{t('appointments.subject', { defaultValue: 'Subject' })}</label>
                <input id="rem-subject" className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div>
                <label className={labelCls} htmlFor="rem-body">{t('appointments.message', { defaultValue: 'Message' })}</label>
                <textarea id="rem-body" rows={8} className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} />
              </div>
            </>
          )}
        </div>
        {draft.data && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-light px-5 py-3">
            <div className="flex gap-2">
              <a
                href={mailtoHref(draft.data.recipient, subject, body)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium hover:bg-surface-secondary"
              >
                <Mail size={14} />
                {t('appointments.open_in_mail', { defaultValue: 'Open in mail app' })}
              </a>
              <Button
                size="sm"
                variant="ghost"
                icon={<Copy size={14} />}
                onClick={() => navigator.clipboard?.writeText(`${subject}\n\n${body}`).then(
                  () => addToast({ type: 'success', title: t('appointments.copied', { defaultValue: 'Copied' }) }),
                  () => undefined,
                )}
              >
                {t('appointments.copy', { defaultValue: 'Copy' })}
              </Button>
            </div>
            {open && (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => mark.mutate('skipped')} disabled={mark.isPending}>
                  {t('appointments.skip', { defaultValue: 'Skip' })}
                </Button>
                <Button size="sm" variant="primary" onClick={() => mark.mutate('sent')} disabled={mark.isPending}>
                  {t('appointments.mark_sent', { defaultValue: 'Mark as sent' })}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
