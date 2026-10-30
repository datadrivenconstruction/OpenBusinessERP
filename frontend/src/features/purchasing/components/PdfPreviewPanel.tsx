import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { SideDrawer } from '@/shared/ui/SideDrawer';
import { Button } from '@/shared/ui/Button';
import { getErrorMessage, triggerDownload } from '@/shared/lib/api';
import { purchasingApi, type PurchasingKind } from '../api';

/** Side panel that renders the server PDF in an iframe from a blob URL. */
export function PdfPreviewPanel({ kind, id, number, open, onClose }: { kind: PurchasingKind; id: string; number: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let objectUrl: string | null = null;
    setErr(null);
    purchasingApi
      .pdf(kind, id)
      .then((b) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(b);
        setBlob(b);
        setUrl(objectUrl);
      })
      .catch((e) => alive && setErr(getErrorMessage(e)));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [open, kind, id]);
  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title={t('purchasing.pdf_preview', { defaultValue: 'PDF preview' })}
      subtitle={number}
      widthClass="w-full max-w-3xl"
      headerActions={
        blob ? (
          <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={() => triggerDownload(blob, `${number || 'document'}.pdf`)}>
            {t('common.download', { defaultValue: 'Download' })}
          </Button>
        ) : null
      }
    >
      {err ? (
        <p className="p-4 text-sm text-semantic-error">{err}</p>
      ) : url ? (
        <iframe title={number} src={url} className="h-[calc(100vh-8rem)] w-full rounded border border-border-light" />
      ) : (
        <p className="p-4 text-sm text-content-tertiary">{t('common.loading', { defaultValue: 'Loading…' })}</p>
      )}
    </SideDrawer>
  );
}

export async function openPdfInTab(kind: PurchasingKind, id: string) {
  const b = await purchasingApi.pdf(kind, id);
  const u = URL.createObjectURL(b);
  window.open(u, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(u), 60_000);
}
