import clsx from 'clsx';
import { initials } from '../lib/timeline';

const TONES = [
  'bg-oe-blue-subtle text-oe-blue-text',
  'bg-oe-purple-subtle text-oe-purple-text',
  'bg-semantic-success-bg text-semantic-success',
  'bg-semantic-warning-bg text-[#b45309]',
  'bg-surface-tertiary text-content-secondary',
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function CustomerAvatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        size === 'sm' ? 'h-7 w-7 text-2xs' : 'h-10 w-10 text-sm',
        TONES[hash(name || '?') % TONES.length],
      )}
    >
      {initials(name)}
    </span>
  );
}
