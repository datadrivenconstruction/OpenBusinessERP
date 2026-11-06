import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCode2 } from 'lucide-react';
import { Button } from '@/shared/ui';
import { EInvoiceModal } from '@/features/finance/EInvoiceModal';
import type { SalesDoc } from '../api';

/** An e-invoice describes an invoice that exists as a document: not a draft, not a cancelled one. */
export const canExportEInvoice = (doc: Pick<SalesDoc, 'kind' | 'status'>): boolean =>
  doc.kind === 'invoice' && doc.status !== 'draft' && doc.status !== 'cancelled';

const SALES_INVOICES = '/api/v1/sales/invoices';

export function EInvoiceCard({ doc }: { doc: SalesDoc }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!canExportEInvoice(doc)) return null;
  return (
    <section className="rounded-xl border border-border-light bg-surface-elevated p-4 shadow-xs">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-content-tertiary">
        {t('sales.einvoice_title', { defaultValue: 'E-invoice' })}
      </h2>
      <p className="mb-3 text-xs text-content-secondary">
        {t('sales.einvoice_hint', {
          defaultValue: 'Checks the invoice against EN 16931 and exports XRechnung, ZUGFeRD or Peppol.',
        })}
      </p>
      <Button variant="secondary" size="sm" icon={<FileCode2 size={14} />} onClick={() => setOpen(true)}>
        {t('sales.einvoice_export', { defaultValue: 'Export e-invoice' })}
      </Button>
      {open && (
        <EInvoiceModal
          open
          onClose={() => setOpen(false)}
          invoiceId={doc.id}
          invoiceNumber={doc.number}
          basePath={SALES_INVOICES}
        />
      )}
    </section>
  );
}
