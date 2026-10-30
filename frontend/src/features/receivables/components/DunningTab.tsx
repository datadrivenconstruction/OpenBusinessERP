/** Dunning tab: level preview for today, draft review (never sent by the app), open payment promises. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { BellRing, Eye, Handshake } from 'lucide-react';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card, EmptyState, SkeletonTable } from '@/shared/ui';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { getErrorMessage } from '@/shared/lib/api';
import { mailtoDraft, previewByLevel, receivablesApi, type DunningLetter } from '../api';
import { FollowUpItem } from './CustomerDrawer';
import { LETTER_VARIANT, inputCls, textareaCls } from './shared';

interface Props {
  error: string | null;
  setError: (v: string | null) => void;
  creating: boolean;
  currency: string;
  onOpenCustomer: (partnerKey: string) => void;
}

type LetterFilter = 'draft' | 'approved' | 'all';

export function DunningTab({ error, setError, creating, currency, onOpenCustomer }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: ['receivables', 'runs'], queryFn: receivablesApi.runs });
  const levels = useQuery({ queryKey: ['receivables', 'levels'], queryFn: receivablesApi.levels });
  const settings = useQuery({ queryKey: ['receivables', 'settings'], queryFn: receivablesApi.settings });
  const preview = useQuery({ queryKey: ['receivables', 'preview'], queryFn: () => receivablesApi.preview() });
  const promises = useQuery({ queryKey: ['receivables', 'promises'], queryFn: () => receivablesApi.promises('open') });
  const [selected, setSelected] = useState<DunningLetter | null>(null);
  const [filter, setFilter] = useState<LetterFilter>('draft');
  const refresh = () => qc.invalidateQueries({ queryKey: ['receivables'] });
  const decide = useMutation({
    mutationFn: ({ id, d }: { id: string; d: 'approved' | 'discarded' }) => receivablesApi.decide(id, d),
    onSuccess: (lt) => { setSelected(lt); void refresh(); },
    onError: (e) => setError(getErrorMessage(e)),
  });
  const save = useMutation({
    mutationFn: (lt: DunningLetter) => receivablesApi.updateLetter(lt.id, { subject: lt.subject, body: lt.body, channel: lt.channel }),
    onSuccess: (lt) => { setSelected(lt); void refresh(); },
    onError: (e) => setError(getErrorMessage(e)),
  });
  const all = (runs.data ?? []).flatMap((r) => r.letters);
  const letters = filter === 'all' ? all : all.filter((l) => l.status === filter);
  const counts = { draft: all.filter((l) => l.status === 'draft').length, approved: all.filter((l) => l.status === 'approved').length, all: all.length };
  const cfg = settings.data;
  const byLevel = previewByLevel(preview.data ?? []);
  const previewTotal = (preview.data ?? []).reduce((s, p) => s + Number(p.outstanding), 0);

  return (
    <div className="space-y-5" id="receivables-panel-dunning" role="tabpanel" aria-labelledby="receivables-tab-dunning">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Eye size={14} />
            {t('receivables.preview_title', { defaultValue: 'If you propose a run today' })}
          </h2>
          <span className="text-xs text-content-tertiary">
            {creating
              ? t('receivables.creating', { defaultValue: 'Preparing drafts…' })
              : t('receivables.drafts_note', { defaultValue: 'Runs only create drafts. Nothing is sent until you approve a draft and deliver it yourself.' })}
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {(levels.data ?? []).map((lv) => (
            <div key={lv.level} className="rounded-lg border border-border-light px-3 py-2">
              <div className="text-xs text-content-tertiary">
                {lv.level}. {lv.name} · {t('receivables.from_days', { defaultValue: 'from {{count}} days past due', count: lv.days_after_due })}
              </div>
              <div className="text-lg font-semibold tabular-nums">{byLevel.get(lv.level) ?? 0}</div>
              <div className="text-xs text-content-tertiary">
                {t('receivables.drafts_would', { defaultValue: 'drafts would be created' })}
                {cfg?.fees_enabled && Number(lv.fee) > 0 && <> · {t('receivables.fee', { defaultValue: 'fee' })} <MoneyDisplay amount={lv.fee} currency={currency} /></>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-content-secondary">
          <span>
            {t('receivables.preview_total', { defaultValue: 'Covers' })} <MoneyDisplay amount={previewTotal} currency={currency} />
          </span>
          {cfg && (
            <span>
              {cfg.fees_enabled ? t('receivables.fees_on', { defaultValue: 'Fees on' }) : t('receivables.fees_off', { defaultValue: 'Fees off' })} ·{' '}
              {cfg.interest_enabled
                ? `${t('receivables.interest_on', { defaultValue: 'Interest' })} ${cfg.interest_rate_pct}%`
                : t('receivables.interest_off', { defaultValue: 'Interest off' })}
            </span>
          )}
        </div>
      </Card>

      {error && <p className="text-sm text-semantic-error">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card padding="none" className="flex max-h-[65vh] flex-col">
          <div className="flex gap-1 border-b border-border-light px-3 py-2" role="group">
            {(['draft', 'approved', 'all'] as LetterFilter[]).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
                className={clsx('rounded-md px-2.5 py-1 text-xs font-medium',
                  filter === f ? 'bg-oe-blue/10 text-oe-blue' : 'text-content-secondary hover:bg-surface-secondary')}>
                {t(`receivables.filter_${f}`, { defaultValue: f === 'draft' ? 'To review' : f === 'approved' ? 'Approved' : 'All' })} ({counts[f]})
              </button>
            ))}
          </div>
          <div className="overflow-y-auto">
            {runs.isLoading ? (
              <div className="p-4"><SkeletonTable rows={6} columns={3} /></div>
            ) : letters.length === 0 ? (
              <EmptyState icon={<BellRing size={22} />} title={t('receivables.no_letters', { defaultValue: 'No dunning drafts yet.' })} />
            ) : (
              letters.map((lt) => (
                <button key={lt.id} type="button" onClick={() => setSelected(lt)}
                  className={clsx('flex w-full items-center justify-between gap-2 border-b border-border-light px-4 py-2 text-left text-sm',
                    selected?.id === lt.id ? 'bg-surface-secondary' : 'hover:bg-surface-secondary')}>
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{lt.customer_name}</span> · {lt.invoice_number} · {t('receivables.level', { defaultValue: 'Level' })} {lt.level}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums"><MoneyDisplay amount={lt.outstanding} currency={lt.currency} /></span>
                    <Badge variant={LETTER_VARIANT[lt.status]} dot>{t(`receivables.status_${lt.status}`, { defaultValue: lt.status })}</Badge>
                  </span>
                </button>
              ))
            )}
          </div>
        </Card>
        {selected ? (
          <Card className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-content-tertiary">
              <button type="button" className="text-oe-blue hover:underline" onClick={() => onOpenCustomer(selected.partner_key)}>
                {selected.customer_name}
              </button>
              <span>
                {selected.days_overdue} {t('receivables.days', { defaultValue: 'days' })} ·{' '}
                {t('receivables.total_due', { defaultValue: 'Total' })}{' '}
                <MoneyDisplay amount={Number(selected.outstanding) + Number(selected.fee) + Number(selected.interest)} currency={selected.currency} />
              </span>
            </div>
            <select className={clsx(inputCls, 'w-full')} value={selected.channel} disabled={selected.status !== 'draft'}
              aria-label={t('receivables.channel', { defaultValue: 'Channel' })}
              onChange={(e) => setSelected({ ...selected, channel: e.target.value as DunningLetter['channel'] })}>
              <option value="letter">{t('receivables.channel_letter', { defaultValue: 'Letter' })}</option>
              <option value="email">{t('receivables.channel_email', { defaultValue: 'Email' })}</option>
            </select>
            <input className={clsx(inputCls, 'w-full font-medium')} value={selected.subject} disabled={selected.status !== 'draft'}
              aria-label={t('receivables.subject', { defaultValue: 'Subject' })}
              onChange={(e) => setSelected({ ...selected, subject: e.target.value })} />
            <textarea className={clsx(textareaCls, 'h-64')} value={selected.body} disabled={selected.status !== 'draft'}
              aria-label={t('receivables.body', { defaultValue: 'Text' })}
              onChange={(e) => setSelected({ ...selected, body: e.target.value })} />
            <div className="flex flex-wrap gap-2">
              {selected.status === 'draft' && (
                <>
                  <Button size="sm" variant="secondary" disabled={save.isPending} onClick={() => save.mutate(selected)}>
                    {t('common.save', { defaultValue: 'Save' })}
                  </Button>
                  <Button size="sm" variant="primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: selected.id, d: 'approved' })}>
                    {t('receivables.approve', { defaultValue: 'Approve' })}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: selected.id, d: 'discarded' })}>
                    {t('receivables.discard', { defaultValue: 'Discard' })}
                  </Button>
                </>
              )}
              {selected.status === 'approved' && (
                <a className="text-sm text-oe-blue underline" href={mailtoDraft(selected)}>
                  {t('receivables.open_in_mail', { defaultValue: 'Open in my mail program' })}
                </a>
              )}
            </div>
          </Card>
        ) : (
          <Card className="flex items-center justify-center text-sm text-content-tertiary">
            {t('receivables.pick_letter', { defaultValue: 'Pick a draft to read and edit it.' })}
          </Card>
        )}
      </div>

      <Card className="space-y-3" id="receivables-promises">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Handshake size={14} />
          {t('receivables.promises_title', { defaultValue: 'Open payment promises' })}
        </h2>
        {(promises.data ?? []).length === 0 ? (
          <p className="text-sm text-content-tertiary">
            {t('receivables.promises_empty', { defaultValue: 'No open promises. Log one from a customer when they commit to a date.' })}
          </p>
        ) : (
          <ul className="space-y-2">
            {(promises.data ?? []).map((f) => <FollowUpItem key={f.id} f={f} currency={currency} showCustomer />)}
          </ul>
        )}
      </Card>
    </div>
  );
}
