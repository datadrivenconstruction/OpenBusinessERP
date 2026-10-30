/** Where a document sits on the quote -> order -> delivered -> invoiced -> paid path. */
import type { DocKind } from '../api';

export const TIMELINE_STEPS = ['quote', 'order', 'delivered', 'invoiced', 'paid'] as const;
export type TimelineStep = (typeof TIMELINE_STEPS)[number];

/** Index of the last reached step (0-based); -1 for cancelled/rejected/expired documents. */
export function timelineIndex(kind: DocKind, status: string): number {
  if (['cancelled', 'rejected', 'expired'].includes(status)) return -1;
  switch (kind) {
    case 'quote':
      return status === 'converted' ? 1 : 0;
    case 'order':
      if (status === 'invoiced') return 3;
      if (status === 'delivered') return 2;
      return 1;
    case 'invoice':
      return status === 'paid' ? 4 : 3;
    default:
      return 3;
  }
}

export function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  return (parts.length === 1 ? first.slice(0, 2) : first.charAt(0) + last.charAt(0)).toUpperCase();
}
