import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { FileText, RefreshCw } from 'lucide-react';
import { Badge, Button } from '@/shared/ui';
import { useToastStore } from '@/stores/useToastStore';
import { getErrorMessage } from '@/shared/lib/api';
import { appointmentsApi, parseLocal, type Reminder, type ReminderStatus } from '../api';
import { ReminderDraftModal } from '../modals/ReminderDraftModal';

const VARIANT: Record<ReminderStatus, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  queued: 'neutral', draft: 'blue', sent: 'success', skipped: 'neutral', failed: 'error',
};
const LABEL: Record<ReminderStatus, string> = {
  queued: 'Scheduled', draft: 'Draft ready', sent: 'Sent', skipped: 'Skipped', failed: 'Failed',
};
type Filter = 'open' | 'all';

/** Reminder drafts queue: prepare due drafts, review each, send it yourself. */
export function RemindersPanel({ enabled }: { enabled: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [filter, setFilter] = useState<Filter>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const reminders = useQuery({ queryKey: ['appointments', 'reminders'], queryFn: appointmentsApi.reminders, retry: false });
  const prepare = useMutation({
    mutationFn: appointmentsApi.prepareReminders,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['appointments', 'reminders'] });
      addToast({ type: 'info', title: t('appointments.drafts_prepared', { defaultValue: '{{count}} drafts ready to review', count: r.draft }) });
    },
    onError: (e) => addToast({ type: 'error', title: getErrorMessage(e) }),
  });
  const all = reminders.data ?? [];
  const rows: Reminder[] = filter === 'open' ? all.filter((r) => r.status === 'queued' || r.status === 'draft') : all;
  const drafts = all.filter((r) => r.status === 'draft').length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {enabled && (
          <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={() => prepare.mutate()} disabled={prepare.isPending}>
            {t('appointments.prepare_due', { defaultValue: 'Prepare due drafts' })}
          </Button>
        )}
        {drafts > 0 && <Badge variant="blue" size="sm">{t('appointments.drafts_waiting', { defaultValue: '{{count}} to send', count: drafts })}</Badge>}
        <div className="ml-auto inline-flex rounded-lg border border-border p-0.5 text-2xs">
          {(['open', 'all'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={clsx('rounded-md px-2 py-0.5', filter === f ? 'bg-surface-secondary font-medium' : 'text-content-secondary')}>
              {f === 'open' ? t('appointments.rem_open', { defaultValue: 'Open' }) : t('appointments.rem_all', { defaultValue: 'All' })}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md bg-surface-secondary p-3 text-xs text-content-tertiary">{t('appointments.no_reminders', { defaultValue: 'No reminders waiting.' })}</p>
      ) : (
        <ul className="max-h-60 divide-y divide-border-light overflow-y-auto rounded-md border border-border-light text-xs">
          {rows.slice(0, 50).map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate">{r.recipient}</span>
              <span className="tabular-nums text-content-tertiary">{parseLocal(r.due_at).toLocaleString(i18n.language, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <Badge size="sm" variant={VARIANT[r.status] ?? 'neutral'}>{t(`appointments.rem_${r.status}`, { defaultValue: LABEL[r.status] ?? r.status })}</Badge>
              <button type="button" className="rounded p-1 text-content-tertiary hover:bg-surface-secondary hover:text-content-primary" aria-label={t('appointments.view_draft', { defaultValue: 'View draft' })} title={t('appointments.view_draft', { defaultValue: 'View draft' })} onClick={() => setOpenId(r.id)}>
                <FileText size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {openId && <ReminderDraftModal reminderId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
