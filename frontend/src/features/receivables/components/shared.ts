/** Receivables UI constants shared by the page, drawer, dunning tab and modals. */
import type { BadgeVariant } from '@/shared/ui/Badge';
import type { Bucket, PromiseStatus } from '../api';

export const BUCKET_LABEL: Record<Bucket, string> = {
  current: 'Not due',
  d1_30: '1–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90_plus: 'Over 90 days',
};

/** Fill colour per bucket, from calm (not due) to urgent (90+). */
export const BUCKET_COLOR: Record<Bucket, string> = {
  current: 'bg-emerald-500',
  d1_30: 'bg-amber-400',
  d31_60: 'bg-orange-500',
  d61_90: 'bg-rose-500',
  d90_plus: 'bg-red-700',
};

export const LETTER_VARIANT = { draft: 'warning', approved: 'success', discarded: 'neutral', sent: 'blue' } as const;

export const PROMISE_VARIANT: Record<PromiseStatus, BadgeVariant> = {
  open: 'blue',
  kept: 'success',
  broken: 'error',
  cancelled: 'neutral',
};

export const inputCls =
  'h-9 rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';
export const textareaCls =
  'w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';
export const th = 'px-4 py-2.5';
export const td = 'px-4 py-2';
