import { useTranslation } from 'react-i18next';
import { BellRing, Download, Send, Trash2, X } from 'lucide-react';
import { Button } from '@/shared/ui';
import type { SalesKind } from '../api';

export function BulkActionBar({
  kind,
  count,
  busy,
  onReminders,
  onExport,
  onMarkSent,
  onDeleteDrafts,
  onClear,
}: {
  kind: SalesKind;
  count: number;
  busy: boolean;
  onReminders: () => void;
  onExport: () => void;
  onMarkSent: () => void;
  onDeleteDrafts: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <div
      role="toolbar"
      aria-label={t('sales.bulk.aria', { defaultValue: 'Bulk actions' })}
      className="flex flex-wrap items-center gap-2 rounded-xl border border-oe-blue/30 bg-oe-blue-subtle px-3 py-2"
    >
      <span className="text-sm font-medium text-oe-blue-text">
        {t('sales.bulk.selected', { defaultValue: '{{count}} selected', count })}
      </span>
      <div className="ml-auto flex flex-wrap gap-2">
        {kind === 'invoices' && (
          <Button size="sm" variant="secondary" icon={<BellRing size={14} />} disabled={busy} onClick={onReminders}>
            {t('sales.bulk.reminders', { defaultValue: 'Reminder drafts' })}
          </Button>
        )}
        <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={onExport}>
          {t('sales.bulk.export', { defaultValue: 'Export CSV' })}
        </Button>
        {kind !== 'credit-notes' && (
          <Button size="sm" variant="secondary" icon={<Send size={14} />} disabled={busy} onClick={onMarkSent}>
            {t('sales.bulk.mark_sent', { defaultValue: 'Mark sent' })}
          </Button>
        )}
        <Button size="sm" variant="danger" icon={<Trash2 size={14} />} disabled={busy} onClick={onDeleteDrafts}>
          {t('sales.bulk.delete_drafts', { defaultValue: 'Delete drafts' })}
        </Button>
        <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClear}>
          {t('sales.bulk.clear', { defaultValue: 'Clear' })}
        </Button>
      </div>
    </div>
  );
}
