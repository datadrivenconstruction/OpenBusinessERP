import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { MoreHorizontal } from 'lucide-react';

export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Small kebab dropdown; closes on outside click and Escape. */
export function ActionMenu({
  items,
  label,
  trigger,
  align = 'right',
  up = false,
}: {
  items: ActionMenuItem[];
  label: string;
  trigger?: ReactNode;
  align?: 'left' | 'right';
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-content-secondary hover:bg-surface-secondary hover:text-content-primary"
      >
        {trigger ?? <MoreHorizontal size={16} />}
      </button>
      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute z-30 min-w-[190px] rounded-lg border border-border-light bg-surface-elevated py-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
            up ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it.onSelect();
              }}
              className={clsx(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm disabled:opacity-40',
                it.danger ? 'text-semantic-error hover:bg-semantic-error-bg' : 'text-content-primary hover:bg-surface-secondary',
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
