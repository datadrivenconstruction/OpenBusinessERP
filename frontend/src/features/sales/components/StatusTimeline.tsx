import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Check, XCircle } from 'lucide-react';
import type { DocKind } from '../api';
import { TIMELINE_STEPS, timelineIndex } from '../lib/timeline';

const LABELS: Record<(typeof TIMELINE_STEPS)[number], string> = {
  quote: 'Quote',
  order: 'Order',
  delivered: 'Delivered',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

export function StatusTimeline({ kind, status }: { kind: DocKind; status: string }) {
  const { t } = useTranslation();
  const idx = timelineIndex(kind, status);
  if (idx < 0) {
    return (
      <div className="inline-flex items-center gap-1.5 text-sm text-semantic-error">
        <XCircle size={14} />
        {t(`sales.status_${status}`, { defaultValue: status })}
      </div>
    );
  }
  return (
    <ol className="flex items-center gap-0" aria-label={t('sales.timeline.aria', { defaultValue: 'Document progress' })}>
      {TIMELINE_STEPS.map((s, i) => {
        const done = i < idx || (i === idx && (s === 'paid' || status !== 'draft'));
        const current = i === idx;
        return (
          <li key={s} className="flex items-center" aria-current={current ? 'step' : undefined}>
            {i > 0 && <span className={clsx('h-0.5 w-6 sm:w-10', i <= idx ? 'bg-oe-blue' : 'bg-border-light')} />}
            <span className="flex flex-col items-center gap-1">
              <span
                className={clsx(
                  'flex h-6 w-6 items-center justify-center rounded-full border-2 text-2xs font-semibold',
                  done ? 'border-oe-blue bg-oe-blue text-white' : current ? 'border-oe-blue text-oe-blue' : 'border-border-light text-content-tertiary',
                )}
              >
                {done ? <Check size={12} /> : i + 1}
              </span>
              <span className={clsx('text-2xs', current ? 'font-medium text-content-primary' : 'text-content-tertiary')}>
                {t(`sales.timeline.${s}`, { defaultValue: LABELS[s] })}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
