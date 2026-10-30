import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Split } from 'lucide-react';
import { Badge, MoneyDisplay } from '@/shared/ui';
import type { Suggestion } from '../api';
import { confidenceOf } from '../logic';
import { reasonInfo } from '../reconcile';

const CONF_VARIANT = { high: 'success', medium: 'blue', low: 'neutral' } as const;
const BAR = { high: 'bg-semantic-success', medium: 'bg-oe-blue', low: 'bg-content-tertiary' } as const;

interface Props {
  index: number;
  suggestion: Suggestion;
  currency: string;
  selected: boolean;
  onSelect: () => void;
}

/** One ranked suggestion with the signals that produced its score. */
export function SuggestionCard({ index, suggestion: s, currency, selected, onSelect }: Props) {
  const { t } = useTranslation();
  const conf = confidenceOf(s.score);
  const pct = Math.round(s.score * 100);
  const diff = Number(s.difference);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        'w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
        selected ? 'border-oe-blue bg-oe-blue/5 ring-1 ring-oe-blue/30' : 'border-border-light hover:bg-surface-secondary',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-content-primary">
          <kbd className="rounded border border-border-light px-1 text-[10px] text-content-tertiary">{index + 1}</kbd>
          {s.is_split && <Split size={13} className="shrink-0 text-oe-blue" aria-label={t('banking.split', { defaultValue: 'Split' })} />}
          <span className="truncate">{s.allocations.map((a) => a.number).join(' + ')}</span>
        </span>
        <Badge size="sm" variant={CONF_VARIANT[conf]}>
          {t(`banking.conf_${conf}`, { defaultValue: conf })} {pct}%
        </Badge>
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-surface-tertiary" aria-hidden>
        <div className={clsx('h-full rounded', BAR[conf])} style={{ width: `${pct}%` }} />
      </div>
      {s.is_split && (
        <ul className="mt-2 space-y-0.5 text-xs text-content-secondary">
          {s.allocations.map((a) => (
            <li key={a.id} className="flex justify-between">
              <span>{a.number}</span>
              <MoneyDisplay amount={a.amount} currency={currency} />
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-2 flex flex-wrap gap-1" aria-label={t('banking.why', { defaultValue: 'Why this match' })}>
        {s.reasons.map((r) => {
          const info = reasonInfo(r);
          return (
            <li key={r} className="inline-flex items-center gap-1 rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] text-content-secondary">
              {t(`banking.reason_${info.key}`, { defaultValue: info.defaultValue, n: info.n })}
              {info.weight && <span className="font-semibold text-content-primary">{info.weight}</span>}
            </li>
          );
        })}
      </ul>
      {diff !== 0 && (
        <div className="mt-1.5 text-xs text-content-secondary">
          {t('banking.difference', { defaultValue: 'Difference' })}: <MoneyDisplay amount={diff} currency={currency} />
        </div>
      )}
    </button>
  );
}
