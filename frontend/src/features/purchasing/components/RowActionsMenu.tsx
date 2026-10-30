import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, CreditCard, FileDown, FileText, MoreHorizontal, PackageCheck, Send } from 'lucide-react';
import { balanceDue } from '../helpers';
import type { PurchasingDocSummary } from '../api';

export type RowAction = 'pdf' | 'mark_sent' | 'duplicate' | 'receive' | 'bill' | 'pay';

export function availableActions(d: PurchasingDocSummary, isOrder: boolean): RowAction[] {
  const a: RowAction[] = ['pdf'];
  if (d.status === 'draft') a.push('mark_sent');
  a.push('duplicate');
  if (isOrder) {
    if (['confirmed', 'partially_received'].includes(d.status)) a.push('receive');
    if (['confirmed', 'partially_received', 'received'].includes(d.status)) a.push('bill');
  } else if (d.kind !== 'credit_note' && ['posted', 'partially_paid'].includes(d.status) && balanceDue(d) > 0) {
    a.push('pay');
  }
  return a;
}

const META: Record<RowAction, { icon: React.ElementType; label: string }> = {
  pdf: { icon: FileDown, label: 'Open PDF' },
  mark_sent: { icon: Send, label: 'Mark as sent' },
  duplicate: { icon: Copy, label: 'Duplicate' },
  receive: { icon: PackageCheck, label: 'Receive goods' },
  bill: { icon: FileText, label: 'Create bill' },
  pay: { icon: CreditCard, label: 'Record payment' },
};

export function RowActionsMenu({ doc, isOrder, onAction }: { doc: PurchasingDocSummary; isOrder: boolean; onAction: (a: RowAction) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const actions = availableActions(doc, isOrder);
  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('purchasing.row_actions', { defaultValue: 'Actions for {{number}}', number: doc.number })}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="rounded p-1 text-content-tertiary hover:bg-surface-secondary hover:text-content-primary"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-border-light bg-surface-elevated py-1 shadow-lg">
          {actions.map((a) => {
            const Icon = META[a].icon;
            return (
              <button
                key={a}
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onAction(a);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-content-primary hover:bg-surface-secondary"
              >
                <Icon size={14} className="text-content-tertiary" />
                {t(`purchasing.action_${a}`, { defaultValue: META[a].label })}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
