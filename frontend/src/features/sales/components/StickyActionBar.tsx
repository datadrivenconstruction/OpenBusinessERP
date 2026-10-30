import { useTranslation } from 'react-i18next';
import { Eye, Mail, Save } from 'lucide-react';
import { Button } from '@/shared/ui';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';

export function StickyActionBar({
  dirty,
  editable,
  busy,
  canSave,
  primary,
  onSave,
  onPreview,
  onSend,
  more,
}: {
  dirty: boolean;
  editable: boolean;
  busy: boolean;
  canSave: boolean;
  primary?: { label: string; onClick: () => void };
  onSave: () => void;
  onPreview?: () => void;
  onSend?: () => void;
  more: ActionMenuItem[];
}) {
  const { t } = useTranslation();
  return (
    <div className="sticky bottom-0 z-20 -mx-4 border-t border-border-light bg-surface-primary/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        {dirty && (
          <span className="flex items-center gap-1.5 text-xs text-semantic-warning">
            <span className="h-2 w-2 rounded-full bg-semantic-warning" />
            {t('sales.unsaved', { defaultValue: 'Unsaved changes' })}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {more.length > 0 && <ActionMenu items={more} up label={t('sales.more_actions', { defaultValue: 'More actions' })} />}
          {onPreview && (
            <Button size="sm" variant="ghost" icon={<Eye size={14} />} onClick={onPreview} disabled={dirty}>
              {t('sales.pdf.preview', { defaultValue: 'PDF preview' })}
            </Button>
          )}
          {onSend && (
            <Button size="sm" variant="secondary" icon={<Mail size={14} />} onClick={onSend} disabled={dirty}>
              {t('sales.send', { defaultValue: 'Send' })}
            </Button>
          )}
          {editable && (
            <Button size="sm" variant={primary ? 'secondary' : 'primary'} icon={<Save size={14} />} onClick={onSave} disabled={busy || !canSave} loading={busy}>
              {t('sales.save_draft', { defaultValue: 'Save draft' })}
            </Button>
          )}
          {primary && (
            <Button size="sm" variant="primary" onClick={primary.onClick} disabled={busy || dirty}>
              {primary.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
