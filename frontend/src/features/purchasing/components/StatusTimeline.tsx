import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Check, CircleDashed, Minus } from 'lucide-react';
import { TIMELINE_STEPS, type StepState, type TimelineStep } from '../helpers';

const LABEL: Record<TimelineStep, string> = { ordered: 'Ordered', received: 'Received', billed: 'Billed', paid: 'Paid' };

export function StatusTimeline({ steps }: { steps: Record<TimelineStep, StepState> }) {
  const { t } = useTranslation();
  return (
    <ol className="flex items-center gap-1" aria-label={t('purchasing.timeline', { defaultValue: 'Progress' })}>
      {TIMELINE_STEPS.map((k, i) => {
        const s = steps[k];
        return (
          <li key={k} className="flex items-center gap-1" data-state={s}>
            {i > 0 && <span className={clsx('h-px w-6 sm:w-10', s === 'done' || s === 'partial' ? 'bg-oe-blue' : 'bg-border')} />}
            <span
              className={clsx(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                s === 'done' && 'bg-semantic-success-bg text-semantic-success',
                s === 'partial' && 'bg-semantic-warning-bg text-[#b45309]',
                s === 'todo' && 'bg-surface-secondary text-content-secondary',
                s === 'skipped' && 'text-content-tertiary line-through',
              )}
            >
              {s === 'done' ? <Check size={12} /> : s === 'skipped' ? <Minus size={12} /> : <CircleDashed size={12} />}
              {t(`purchasing.step_${k}`, { defaultValue: LABEL[k] })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
