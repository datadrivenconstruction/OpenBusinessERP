import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Eye, Save, Send } from 'lucide-react';
import { Button } from '@/shared/ui/Button';

export interface MoreAction {
  key: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}

interface Props {
  dirty: boolean;
  busy: boolean;
  canSave: boolean;
  primary?: { label: string; onClick: () => void };
  onPreview?: () => void;
  onSend?: () => void;
  more: MoreAction[];
  onSave: () => void;
}

export function StickyActionBar({ dirty, busy, canSave, primary, onPreview, onSend, more, onSave }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-t border-border-light bg-surface-primary/95 px-4 py-3 backdrop-blur">
      <span className="text-xs text-content-tertiary">
        {dirty ? t('purchasing.unsaved', { defaultValue: 'Unsaved changes' }) : t('purchasing.saved', { defaultValue: 'All changes saved' })}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {more.length > 0 && (
          <div ref={ref} className="relative">
            <Button size="sm" variant="ghost" icon={<ChevronDown size={14} />} iconPosition="right" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {t('purchasing.more', { defaultValue: 'More' })}
            </Button>
            {open && (
              <div role="menu" className="absolute bottom-full right-0 mb-1 w-52 rounded-lg border border-border-light bg-surface-elevated py-1 shadow-lg">
                {more.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      m.onClick();
                    }}
                    className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-secondary ${m.danger ? 'text-semantic-error' : 'text-content-primary'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {onPreview && (
          <Button size="sm" variant="secondary" icon={<Eye size={14} />} onClick={onPreview}>
            {t('purchasing.pdf_preview', { defaultValue: 'PDF preview' })}
          </Button>
        )}
        {onSend && (
          <Button size="sm" variant="secondary" icon={<Send size={14} />} disabled={busy} onClick={onSend}>
            {t('purchasing.action_send', { defaultValue: 'Send' })}
          </Button>
        )}
        {canSave && (
          <Button size="sm" variant={primary ? 'secondary' : 'primary'} icon={<Save size={14} />} loading={busy} disabled={busy || !dirty} onClick={onSave}>
            {t('purchasing.save_draft', { defaultValue: 'Save draft' })}
          </Button>
        )}
        {primary && (
          <Button size="sm" variant="primary" disabled={busy} onClick={primary.onClick}>
            {primary.label}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Warns on tab close and on in-app link clicks while the form has unsaved edits (BrowserRouter has no useBlocker). */
export function useUnsavedGuard(dirty: boolean, message: string) {
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
      if (a.origin !== window.location.origin) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, message]);
}
