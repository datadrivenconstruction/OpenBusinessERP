/** Aging overview: one stacked bar plus a clickable tile per bucket that filters the customer list. */
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Card } from '@/shared/ui';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { BUCKETS, bucketShares, type Aging, type Bucket } from '../api';
import { BUCKET_COLOR, BUCKET_LABEL } from './shared';
import { fmtList } from '@/shared/lib/formatters';

interface Props {
  aging: Aging;
  currency: string;
  selected: Bucket | null;
  onSelect: (b: Bucket | null) => void;
}

export function AgingChart({ aging, currency, selected, onSelect }: Props) {
  const { t } = useTranslation();
  const shares = bucketShares(aging.totals);
  const counts = Object.fromEntries(
    BUCKETS.map((b) => [b, aging.rows.filter((r) => Number(r[b]) !== 0).length]),
  ) as Record<Bucket, number>;
  const label = (b: Bucket) => t(`receivables.bucket_${b}`, { defaultValue: BUCKET_LABEL[b] });
  const toggle = (b: Bucket) => onSelect(selected === b ? null : b);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-content-primary">
          {t('receivables.chart_title', { defaultValue: 'Where the open balance sits' })}
        </h2>
        {selected && (
          <button type="button" className="text-xs text-oe-blue hover:underline" onClick={() => onSelect(null)}>
            {t('receivables.clear_filter', { defaultValue: 'Show all customers' })}
          </button>
        )}
      </div>
      <div
        className="flex h-4 w-full overflow-hidden rounded-full bg-surface-secondary"
        role="img"
        aria-label={fmtList(BUCKETS.map((b) => `${label(b)} ${shares[b]}%`))}
      >
        {BUCKETS.map((b) =>
          shares[b] > 0 ? (
            <button
              key={b}
              type="button"
              tabIndex={-1}
              aria-hidden
              title={`${label(b)} · ${shares[b]}%`}
              onClick={() => toggle(b)}
              className={clsx(
                BUCKET_COLOR[b],
                'h-full transition-opacity',
                selected && selected !== b && 'opacity-30',
              )}
              style={{ width: `${shares[b]}%` }}
            />
          ) : null,
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {BUCKETS.map((b) => {
          const active = selected === b;
          return (
            <button
              key={b}
              type="button"
              aria-pressed={active}
              disabled={counts[b] === 0}
              onClick={() => toggle(b)}
              className={clsx(
                'rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-50',
                active ? 'border-oe-blue bg-oe-blue/5' : 'border-border-light hover:bg-surface-secondary',
              )}
            >
              <span className="flex items-center gap-1.5 text-xs text-content-tertiary">
                <span className={clsx('h-2 w-2 rounded-full', BUCKET_COLOR[b])} />
                {label(b)}
              </span>
              <span className="mt-0.5 block text-sm font-semibold tabular-nums text-content-primary">
                <MoneyDisplay amount={aging.totals[b]} currency={currency} />
              </span>
              <span className="block text-xs text-content-tertiary">
                {shares[b]}% · {t('receivables.customers_count', { defaultValue: '{{count}} customers', count: counts[b] })}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
