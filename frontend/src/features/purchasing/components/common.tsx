import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/Badge';
import { STATUS_VARIANT } from '../api';
import { initials } from '../helpers';

export const inputCls =
  'h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue disabled:bg-surface-secondary';
export const cellInput =
  'w-full rounded border border-border-light bg-surface-primary px-2 py-1 text-sm text-content-primary focus:border-oe-blue focus:outline-none disabled:bg-surface-secondary';

const AVATAR_TONES = [
  'bg-oe-blue-subtle text-oe-blue-text',
  'bg-oe-purple-subtle text-oe-purple-text',
  'bg-semantic-success-bg text-semantic-success',
  'bg-semantic-warning-bg text-[#b45309]',
  'bg-surface-secondary text-content-secondary',
];

export function SupplierAvatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const h = [...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        size === 'sm' ? 'h-7 w-7 text-2xs' : 'h-10 w-10 text-sm',
        AVATAR_TONES[h % AVATAR_TONES.length],
      )}
    >
      {initials(name || '?')}
    </span>
  );
}

export function StatusBadge({ status, size }: { status: string; size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'neutral'} size={size} dot>
      {t(`purchasing.status_${status}`, { defaultValue: status.replace(/_/g, ' ') })}
    </Badge>
  );
}

export function ReceivedBar({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="flex items-center gap-2" title={`${p}%`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-secondary">
        <div
          className={clsx('h-full rounded-full', p >= 100 ? 'bg-semantic-success' : p > 0 ? 'bg-semantic-warning' : 'bg-content-tertiary')}
          style={{ width: `${p}%` }}
        />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-content-secondary">{p}%</span>
    </div>
  );
}

export function Section({ title, actions, children, className }: { title: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-xl border border-border-light bg-surface-elevated p-4 shadow-xs', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-content-primary">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
