import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Button, SideDrawer } from '@/shared/ui';
import { triggerDownload } from '@/shared/lib/api';
import { fetchSalesPdf, type SalesKind } from '../api';

/** Side panel with the server-rendered PDF in an iframe (blob URL, revoked on close). */
export function PdfPreviewPanel({
  kind,
  id,
  filename,
  open,
  onClose,
}: {
  kind: SalesKind;
  id: string;
  filename: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let made: string | null = null;
    setErr(null);
    setUrl(null);
    fetchSalesPdf(kind, id)
      .then((b) => {
        if (!alive) return;
        made = URL.createObjectURL(b);
        setBlob(b);
        setUrl(made);
      })
      .catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [open, kind, id]);
  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title={t('sales.pdf.preview', { defaultValue: 'PDF preview' })}
      subtitle={filename}
      widthClass="w-full sm:w-[min(820px,90vw)]"
      headerActions={
        blob && (
          <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={() => triggerDownload(blob, filename)}>
            {t('sales.download_pdf', { defaultValue: 'Download PDF' })}
          </Button>
        )
      }
    >
      {err ? (
        <p className="p-4 text-sm text-semantic-error">{err}</p>
      ) : url ? (
        <iframe title={filename} src={url} className="h-[calc(100vh-120px)] w-full rounded border border-border-light" />
      ) : (
        <p className="p-4 text-sm text-content-tertiary">{t('sales.pdf.loading', { defaultValue: 'Rendering PDF…' })}</p>
      )}
    </SideDrawer>
  );
}
