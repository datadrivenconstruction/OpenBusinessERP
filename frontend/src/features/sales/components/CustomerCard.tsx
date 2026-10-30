import { useTranslation } from 'react-i18next';
import { Mail, MapPin, Receipt } from 'lucide-react';
import { ContactSearchInput } from '@/shared/ui/ContactSearchInput';
import type { SalesForm } from '../lib/form';
import { CustomerAvatar } from './CustomerAvatar';

const input =
  'w-full rounded-lg border border-border-light bg-surface-primary px-2 py-1 text-sm text-content-primary focus:border-oe-blue focus:outline-none aria-[invalid=true]:border-semantic-error';

export function CustomerCard({
  form,
  set,
  editable,
  error,
}: {
  form: SalesForm;
  set: (patch: Partial<SalesForm>) => void;
  editable: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="rounded-xl border border-border-light bg-surface-elevated p-4 shadow-xs">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-content-tertiary">
        {t('sales.customer', { defaultValue: 'Customer' })}
      </h2>
      {editable ? (
        <div className="space-y-2">
          <ContactSearchInput
            value={form.customer_id}
            displayValue={form.customer_name}
            onChange={(id, name) => set({ customer_id: id, customer_name: name })}
            showBrowse
          />
          {error && <p className="text-xs text-semantic-error">{error}</p>}
          <label className="block text-xs text-content-tertiary">
            {t('sales.customer_address', { defaultValue: 'Customer address' })}
            <textarea className={`${input} min-h-[64px]`} value={form.customer_address} onChange={(e) => set({ customer_address: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-content-tertiary">
              {t('sales.customer_vat_id', { defaultValue: 'Customer VAT ID' })}
              <input className={input} value={form.customer_vat_id} onChange={(e) => set({ customer_vat_id: e.target.value })} />
            </label>
            <label className="text-xs text-content-tertiary">
              {t('sales.customer_email', { defaultValue: 'Customer e-mail' })}
              <input type="email" className={input} value={form.customer_email} onChange={(e) => set({ customer_email: e.target.value })} />
            </label>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <CustomerAvatar name={form.customer_name} size="md" />
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-medium text-content-primary">{form.customer_name || '—'}</p>
            {form.customer_address && (
              <p className="flex gap-1.5 whitespace-pre-line text-content-secondary">
                <MapPin size={14} className="mt-0.5 shrink-0 text-content-tertiary" />
                {form.customer_address}
              </p>
            )}
            {form.customer_vat_id && (
              <p className="flex items-center gap-1.5 text-content-secondary">
                <Receipt size={14} className="text-content-tertiary" />
                {form.customer_vat_id}
              </p>
            )}
            {form.customer_email && (
              <a href={`mailto:${form.customer_email}`} className="flex items-center gap-1.5 text-oe-blue hover:underline">
                <Mail size={14} />
                {form.customer_email}
              </a>
            )}
            {form.payment_terms && (
              <p className="text-xs text-content-tertiary">
                {t('sales.payment_terms', { defaultValue: 'Payment terms' })}: {form.payment_terms}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
