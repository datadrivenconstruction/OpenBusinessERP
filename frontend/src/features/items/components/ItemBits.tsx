import type { ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { AuthImage } from '@/shared/ui/AuthImage';
import type { Item, ItemType } from '../api';
import { avatarHue, initials, marginTone, stockLevel, type StockLevel } from '../itemsLogic';
import { fmtUpTo } from '@/shared/lib/formatters';

export const TYPE_LABEL: Record<ItemType, string> = { goods: 'Goods', service: 'Service', consumable: 'Consumable' };

export const control =
  'h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue disabled:opacity-60';

export function ItemThumb({ item, size = 32 }: { item: Pick<Item, 'name' | 'sku' | 'image_url'>; size?: number }) {
  const style = { width: size, height: size };
  if (item.image_url) {
    return <AuthImage src={item.image_url} alt="" style={style} className="shrink-0 rounded-md object-cover border border-border-light" />;
  }
  const hue = avatarHue(item.sku || item.name);
  return (
    <span
      aria-hidden
      style={{ ...style, background: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 45% 32%)` }}
      className="inline-flex shrink-0 items-center justify-center rounded-md text-[11px] font-semibold"
    >
      {initials(item.name)}
    </span>
  );
}

const TONE_CLS = {
  success: 'text-semantic-success',
  warning: 'text-semantic-warning',
  danger: 'text-semantic-error',
  neutral: 'text-content-tertiary',
} as const;

export function MarginText({ pct, className }: { pct: number | null; className?: string }) {
  return (
    <span className={clsx('tabular-nums font-medium', TONE_CLS[marginTone(pct)], className)}>
      {pct === null ? '—' : `${fmtUpTo(pct, 1)}%`}
    </span>
  );
}

const STOCK_CLS: Record<StockLevel, string> = {
  none: 'text-content-tertiary',
  out: 'text-semantic-error',
  low: 'text-semantic-warning',
  ok: 'text-content-primary',
};

export function StockCell({ item, onHand }: { item: Item; onHand: string | undefined }) {
  const { t } = useTranslation();
  const level = stockLevel(item, onHand);
  if (level === 'none') return <span className="text-content-tertiary">—</span>;
  const qty = Number(onHand ?? 0);
  return (
    <span className={clsx('tabular-nums', STOCK_CLS[level])} title={
      level === 'low' ? t('items.stock_low', { defaultValue: 'Below minimum stock' })
        : level === 'out' ? t('items.stock_out', { defaultValue: 'Out of stock' }) : undefined
    }>
      {fmtUpTo(qty, 2)} <span className="text-xs text-content-tertiary">{item.uom}</span>
    </span>
  );
}

export function Field({ label, children, hint, error, className }: {
  label: string; children: ReactNode; hint?: string; error?: string; className?: string;
}) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-content-secondary">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-xs text-semantic-error">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-content-tertiary">{hint}</span>
      ) : null}
    </label>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border-light bg-surface-primary p-4">
      <h3 className="text-sm font-semibold text-content-primary">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-content-tertiary">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
