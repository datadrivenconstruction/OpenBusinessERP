import { useTranslation } from 'react-i18next';
import { Download, Send, Trash2, Wallet, X } from 'lucide-react';
import { Button } from '@/shared/ui/Button';

interface Props {
  count: number;
  isOrder: boolean;
  busy?: boolean;
  onExport: () => void;
  onMarkSent: () => void;
  onDeleteDrafts: () => void;
  onPaymentRun?: () => void;
  onClear: () => void;
}

export function BulkActionBar({ count, isOrder, busy, onExport, onMarkSent, onDeleteDrafts, onPaymentRun, onClear }: Props) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={t('purchasing.bulk_aria', { defaultValue: 'Bulk actions' })}
      className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-oe-blue/30 bg-oe-blue-subtle px-3 py-2 shadow-sm"
    >
      <span className="text-sm font-medium text-oe-blue-text">
        {t('purchasing.bulk_selected', { defaultValue: '{{count}} selected', count })}
      </span>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={onExport}>
          {t('purchasing.bulk_export', { defaultValue: 'Export CSV' })}
        </Button>
        {isOrder && (
          <Button size="sm" variant="secondary" icon={<Send size={14} />} disabled={busy} onClick={onMarkSent}>
            {t('purchasing.action_mark_sent', { defaultValue: 'Mark as sent' })}
          </Button>
        )}
        {!isOrder && onPaymentRun && (
          <Button size="sm" variant="secondary" icon={<Wallet size={14} />} onClick={onPaymentRun}>
            {t('purchasing.bulk_payment_run', { defaultValue: 'Payment run' })}
          </Button>
        )}
        <Button size="sm" variant="danger" icon={<Trash2 size={14} />} disabled={busy} onClick={onDeleteDrafts}>
          {t('purchasing.bulk_delete_drafts', { defaultValue: 'Delete drafts' })}
        </Button>
        <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClear} aria-label={t('common.clear_selection', { defaultValue: 'Clear selection' })} />
      </div>
    </div>
  );
}
