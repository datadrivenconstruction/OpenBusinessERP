import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import { itemsApi, type Item } from '@/features/items/api';
import { MoneyDisplay } from '@/shared/ui';

/** Description input with an item-catalogue dropdown; picking an item fills SKU, text and price. */
export function ItemPicker({
  value,
  onChange,
  onPick,
  onEnter,
  disabled,
  invalid,
  inputRef,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (item: Item) => void;
  onEnter: () => void;
  disabled?: boolean;
  invalid?: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = window.setTimeout(() => setTerm(value.trim()), 250);
    return () => window.clearTimeout(h);
  }, [value]);
  const res = useQuery({
    queryKey: ['items', 'picker', term],
    queryFn: () => itemsApi.list({ q: term, active: true, limit: 8 }),
    enabled: open && term.length >= 2,
    retry: false,
    staleTime: 30_000,
  });
  const items = res.data?.items ?? [];
  useEffect(() => setHi(0), [term]);
  const pick = (it: Item) => {
    onPick(it);
    setOpen(false);
  };
  return (
    <div
      ref={box}
      className="relative"
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <input
        ref={inputRef}
        className={className}
        disabled={disabled}
        aria-invalid={invalid}
        value={value}
        placeholder={t('sales.lines.search_item', { defaultValue: 'Type to search items or describe…' })}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (open && items.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setHi((h) => (h + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const it = items[hi];
            if (open && it) pick(it);
            else onEnter();
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && items.length > 0 && (
        <ul role="listbox" className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full min-w-[320px] overflow-auto rounded-lg border border-border-light bg-surface-elevated py-1 shadow-lg">
          {items.map((it, i) => (
            <li key={it.id} role="option" aria-selected={i === hi}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(it)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === hi ? 'bg-surface-secondary' : ''}`}
              >
                <Package size={14} className="shrink-0 text-content-tertiary" />
                <span className="font-mono text-xs text-content-tertiary">{it.sku}</span>
                <span className="flex-1 truncate text-content-primary">{it.name}</span>
                <MoneyDisplay amount={it.sales_price} currency={it.currency} className="text-xs text-content-secondary" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
