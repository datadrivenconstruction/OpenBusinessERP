import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { itemsApi, type Item } from '@/features/items/api';
import { cellInput } from './common';

/** Typeahead over the item catalogue; free text is kept when nothing is picked. */
export function ItemPicker({ sku, disabled, onPick, onSku }: { sku: string; disabled?: boolean; onPick: (it: Item) => void; onSku: (s: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = setTimeout(() => setQ(sku), 200);
    return () => clearTimeout(h);
  }, [sku]);
  const res = useQuery({
    queryKey: ['items', 'purchasing-picker', q],
    queryFn: () => itemsApi.list({ q: q || undefined, active: true, limit: 12 }),
    enabled: open,
    retry: false,
    staleTime: 30_000,
  });
  const items = res.data?.items ?? [];
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const pick = (it: Item) => {
    onPick(it);
    setOpen(false);
  };
  return (
    <div ref={ref} className="relative">
      <input
        className={`${cellInput} font-mono text-xs`}
        disabled={disabled}
        value={sku}
        role="combobox"
        aria-expanded={open}
        aria-label={t('purchasing.item', { defaultValue: 'Item' })}
        placeholder={t('purchasing.item_ph', { defaultValue: 'Search item…' })}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onSku(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(items.length - 1, h + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(0, h - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const it = items[hi];
            if (it) pick(it);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && items.length > 0 && (
        <ul role="listbox" className="absolute left-0 z-30 mt-1 max-h-64 w-80 overflow-auto rounded-lg border border-border-light bg-surface-elevated py-1 shadow-lg">
          {items.map((it, i) => (
            <li
              key={it.id}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(it);
              }}
              onMouseEnter={() => setHi(i)}
              className={`cursor-pointer px-3 py-1.5 text-sm ${i === hi ? 'bg-surface-secondary' : ''}`}
            >
              <span className="mr-2 font-mono text-xs text-content-tertiary">{it.sku}</span>
              {it.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
