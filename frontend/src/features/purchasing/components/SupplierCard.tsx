import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ContactSearchInput } from '@/shared/ui/ContactSearchInput';
import { fetchContact, type Contact } from '@/features/contacts/api';
import { Section, SupplierAvatar } from './common';

function addressLines(a: Record<string, unknown> | null | undefined): string[] {
  if (!a) return [];
  const g = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '');
  return [g('street') || g('line1'), g('line2'), [g('postal_code') || g('zip'), g('city')].filter(Boolean).join(' '), g('country')].filter(Boolean);
}

interface Props {
  supplierId: string;
  supplierName: string;
  editable: boolean;
  error?: string;
  onChange: (id: string, name: string, contact?: Contact) => void;
}

/** Supplier picker plus the contact facts that matter on a purchase: address, VAT, payment terms. */
export function SupplierCard({ supplierId, supplierName, editable, error, onChange }: Props) {
  const { t } = useTranslation();
  const contact = useQuery({ queryKey: ['contacts', supplierId], queryFn: () => fetchContact(supplierId), enabled: !!supplierId, retry: false });
  const c = contact.data;
  return (
    <Section title={t('purchasing.supplier', { defaultValue: 'Supplier' })}>
      {editable && (
        <div className="mb-3">
          <ContactSearchInput
            value={supplierId}
            displayValue={supplierName}
            onChange={async (id, name) => {
              onChange(id, name);
              if (id) fetchContact(id).then((ct) => onChange(id, name, ct)).catch(() => undefined);
            }}
            showBrowse
            browseContactTypes={['supplier', 'subcontractor']}
          />
          {error && <p className="mt-1 text-xs text-semantic-error">{error}</p>}
        </div>
      )}
      {supplierName ? (
        <div className="flex gap-3">
          <SupplierAvatar name={supplierName} size="md" />
          <div className="min-w-0 space-y-0.5 text-sm">
            {supplierId ? (
              <Link to={`/contacts?contact=${supplierId}`} className="font-medium text-content-primary hover:underline">{supplierName}</Link>
            ) : (
              <div className="font-medium text-content-primary">{supplierName}</div>
            )}
            {addressLines(c?.address).map((l) => (
              <div key={l} className="text-content-secondary">{l}</div>
            ))}
            {c?.vat_number && (
              <div className="text-content-secondary">
                {t('purchasing.vat_number', { defaultValue: 'VAT' })}: <span className="font-mono">{c.vat_number}</span>
              </div>
            )}
            {c?.payment_terms_days && (
              <div className="text-content-secondary">
                {t('purchasing.terms_days', { defaultValue: 'Payment terms: {{days}} days', days: Number(c.payment_terms_days) })}
              </div>
            )}
            {c?.primary_email && <div className="truncate text-content-tertiary">{c.primary_email}</div>}
          </div>
        </div>
      ) : (
        !editable && <p className="text-sm text-content-tertiary">—</p>
      )}
    </Section>
  );
}
