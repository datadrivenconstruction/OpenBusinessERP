/**
 * Company details & documents (business workspaces): the legal data, bank
 * account, logo and default texts printed on quotes, order confirmations,
 * invoices and credit notes. Stored in /api/v1/business-settings/.
 */

import { useEffect, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Save, Trash2, Upload } from 'lucide-react';
import { apiGet, apiPut, getErrorMessage } from '@/shared/lib/api';
import { Button } from '@/shared/ui/Button';

export const DOC_TEXT_KINDS = ['quote', 'order', 'invoice', 'credit_note'] as const;
export type DocTextKind = (typeof DOC_TEXT_KINDS)[number];
const DOC_TEXT_KEYS = ['intro', 'closing', 'email_subject', 'email_body'] as const;
type DocTextKey = (typeof DOC_TEXT_KEYS)[number];
const MAX_LOGO_BYTES = 500_000;

export interface BusinessDocumentSettings {
  company_name: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  vat_id: string;
  tax_number: string;
  iban: string;
  bic: string;
  bank_name: string;
  register_court: string;
  register_number: string;
  managing_directors: string;
  footer_text: string;
  payment_terms_days: number;
  payment_terms_text: string;
  giro_code: boolean;
  logo_data_url: string;
  document_texts: Partial<Record<DocTextKind, Partial<Record<DocTextKey, string>>>>;
  base_currency?: string;
  country_code?: string;
  fiscal_year_start_month?: number;
  tax_rates?: TaxRate[];
}

export interface TaxRate {
  name: string;
  rate: number;
  default: boolean;
}

/** Section keywords the settings search matches against (lower case). */
const SECTION_KEYWORDS: Record<string, string> = {
  logo: 'logo letterhead image brand',
  address: 'address street city postcode',
  company: 'company legal name email phone website contact',
  tax: 'tax vat register court number managing directors',
  bank: 'bank account iban bic',
  finance: 'finance fiscal year currency country payment terms days sepa qr',
  rates: 'tax rates vat percent default',
  texts: 'templates document texts quote order invoice credit note email subject preview',
};

export function profileMatches(query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || Object.values(SECTION_KEYWORDS).some((k) => k.includes(q));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SAMPLE: Record<string, string> = {
  '{customer_name}': 'Example Customer Ltd', '{document_title}': 'Invoice', '{document_number}': 'INV-000042',
  '{document_date}': '2026-01-15', '{due_date}': '2026-01-29', '{total}': '1,190.00', '{company_name}': '',
};
const fillSample = (text: string, company: string) =>
  Object.entries(SAMPLE).reduce((acc, [k, v]) => acc.split(k).join(k === '{company_name}' ? company : v), text);

type TextField = Exclude<keyof BusinessDocumentSettings, 'payment_terms_days' | 'giro_code' | 'logo_data_url' | 'document_texts' | 'address'>;

const GROUPS: { id: string; titleKey: string; title: string; fields: [TextField, string][] }[] = [
  {
    id: 'company',
    titleKey: 'settings.bizdocs_company',
    title: 'Company',
    fields: [
      ['company_name', 'Legal name'],
      ['email', 'E-mail'],
      ['phone', 'Phone'],
      ['website', 'Website'],
    ],
  },
  {
    id: 'tax',
    titleKey: 'settings.bizdocs_tax',
    title: 'Tax & register',
    fields: [
      ['vat_id', 'VAT ID'],
      ['tax_number', 'Tax number'],
      ['register_court', 'Register court'],
      ['register_number', 'Register number'],
      ['managing_directors', 'Managing directors'],
    ],
  },
  {
    id: 'bank',
    titleKey: 'settings.bizdocs_bank',
    title: 'Bank account',
    fields: [
      ['bank_name', 'Bank'],
      ['iban', 'IBAN'],
      ['bic', 'BIC'],
    ],
  },
  {
    id: 'finance',
    titleKey: 'settings.bizdocs_terms',
    title: 'Payment terms & footer',
    fields: [
      ['payment_terms_text', 'Payment terms text (optional, replaces the generated sentence)'],
      ['footer_text', 'Extra footer line'],
    ],
  },
];

const KIND_LABEL: Record<DocTextKind, string> = {
  quote: 'Quote',
  order: 'Order confirmation',
  invoice: 'Invoice',
  credit_note: 'Credit note',
};
const KEY_LABEL: Record<DocTextKey, string> = {
  intro: 'Opening text',
  closing: 'Closing text',
  email_subject: 'E-mail subject',
  email_body: 'E-mail message',
};
const PLACEHOLDERS = '{customer_name} {document_title} {document_number} {document_date} {due_date} {total} {company_name}';

const input =
  'w-full rounded border border-border-light bg-surface-primary px-2 py-1 text-sm text-content-primary focus:border-border focus:outline-none disabled:bg-surface-secondary';

export function BusinessDocumentsSettings({ canEdit, query = '' }: { canEdit: boolean; query?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['business-settings'],
    queryFn: () => apiGet<BusinessDocumentSettings>('/v1/business-settings/'),
    retry: false,
  });
  const [form, setForm] = useState<BusinessDocumentSettings | null>(null);
  const [textKind, setTextKind] = useState<DocTextKind>('invoice');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (settings.data) setForm({ ...settings.data, document_texts: settings.data.document_texts ?? {}, tax_rates: settings.data.tax_rates ?? [] });
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (body: BusinessDocumentSettings) => apiPut<BusinessDocumentSettings>('/v1/business-settings/', body),
    onSuccess: (data) => {
      qc.setQueryData(['business-settings'], data);
      setMsg(t('common.saved', { defaultValue: 'Saved' }));
    },
    onError: (e) => setMsg(getErrorMessage(e)),
  });

  if (!form) return null;
  const q = query.trim().toLowerCase();
  const show = (id: string) => !q || SECTION_KEYWORDS[id]!.includes(q);
  const rates = form.tax_rates ?? [];
  const setRate = (i: number, patch: Partial<TaxRate>) =>
    set({ tax_rates: rates.map((r, j) => (j === i ? { ...r, ...patch } : patch.default ? { ...r, default: false } : r)) });
  const kindTexts = form.document_texts[textKind] ?? {};
  const set = (patch: Partial<BusinessDocumentSettings>) => {
    setMsg(null);
    setForm({ ...form, ...patch });
  };
  const setText = (key: DocTextKey, value: string) =>
    set({ document_texts: { ...form.document_texts, [textKind]: { ...form.document_texts[textKind], [key]: value } } });

  const onLogo = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > MAX_LOGO_BYTES) {
      setMsg(t('settings.bizdocs_logo_invalid', { defaultValue: 'Logo must be a PNG or JPEG up to 500 KB.' }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set({ logo_data_url: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <section className="mb-6 rounded-md border border-border-light bg-surface-primary p-4" data-testid="business-documents-settings">
      <h2 className="text-base font-semibold text-content-primary">
        {t('settings.bizdocs_title', { defaultValue: 'Company details & documents' })}
      </h2>
      <p className="mb-4 text-sm text-content-secondary">
        {t('settings.bizdocs_intro', {
          defaultValue:
            'Printed on quotes, order confirmations, invoices and credit notes. Invoices are checked for missing data; the check is a help, not a guarantee of legal compliance.',
        })}
      </p>

      {show('logo') && <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex h-16 w-40 items-center justify-center rounded border border-border-light bg-surface-secondary">
          {form.logo_data_url ? (
            <img src={form.logo_data_url} alt={t('settings.bizdocs_logo', { defaultValue: 'Logo' })} className="max-h-14 max-w-[150px]" />
          ) : (
            <span className="text-xs text-content-tertiary">{t('settings.bizdocs_no_logo', { defaultValue: 'No logo' })}</span>
          )}
        </div>
        {canEdit && (
          <>
            <label className="inline-flex cursor-pointer items-center rounded border border-border-light px-2 py-1 text-sm text-content-primary">
              <Upload className="mr-1 h-4 w-4" />
              {t('settings.bizdocs_upload_logo', { defaultValue: 'Upload logo' })}
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={onLogo} />
            </label>
            {form.logo_data_url && (
              <Button size="sm" variant="ghost" onClick={() => set({ logo_data_url: '' })}>
                <Trash2 className="mr-1 h-4 w-4" />
                {t('common.remove', { defaultValue: 'Remove' })}
              </Button>
            )}
          </>
        )}
      </div>}

      {show('address') && <label className="mb-4 block text-xs text-content-tertiary">
        {t('settings.bizdocs_address', { defaultValue: 'Address (street, postcode and city, country - one per line)' })}
        <textarea className={`${input} min-h-[72px]`} disabled={!canEdit} value={form.address} onChange={(e) => set({ address: e.target.value })} />
      </label>}

      {GROUPS.filter((g) => show(g.id)).map((g) => (
        <fieldset key={g.titleKey} className="mb-4">
          <legend className="mb-1 text-sm font-medium text-content-primary">{t(g.titleKey, { defaultValue: g.title })}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.fields.map(([field, label]) => (
              <label key={field} className="text-xs text-content-tertiary">
                {t(`settings.bizdocs_${field}`, { defaultValue: label })}
                <input className={input} disabled={!canEdit} value={String(form[field] ?? "")} onChange={(e) => set({ [field]: e.target.value })} />
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      {show('finance') && <div className="mb-4 flex flex-wrap gap-4">
        <label className="text-xs text-content-tertiary">
          {t('settings.bizdocs_base_currency', { defaultValue: 'Currency (ISO code)' })}
          <input className={`${input} w-28 uppercase`} maxLength={3} disabled={!canEdit} value={form.base_currency ?? ''}
            onChange={(e) => set({ base_currency: e.target.value.toUpperCase() })} />
        </label>
        <label className="text-xs text-content-tertiary">
          {t('settings.bizdocs_country', { defaultValue: 'Country (ISO code)' })}
          <input className={`${input} w-28 uppercase`} maxLength={2} disabled={!canEdit} value={form.country_code ?? ''}
            onChange={(e) => set({ country_code: e.target.value.toUpperCase() })} />
        </label>
        <label className="text-xs text-content-tertiary">
          {t('settings.bizdocs_fiscal_month', { defaultValue: 'Fiscal year starts in' })}
          <select className={`${input} w-40`} disabled={!canEdit} value={form.fiscal_year_start_month ?? 1}
            onChange={(e) => set({ fiscal_year_start_month: Number(e.target.value) })}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{t(`settings.bizdocs_month_${i + 1}`, { defaultValue: m })}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-content-tertiary">
          {t('settings.bizdocs_payment_days', { defaultValue: 'Payment term (days)' })}
          <input type="number" min={0} max={365} className={`${input} w-28`} disabled={!canEdit} value={form.payment_terms_days}
            onChange={(e) => set({ payment_terms_days: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} />
        </label>
        <label className="flex items-center gap-2 self-end text-sm text-content-primary">
          <input type="checkbox" disabled={!canEdit} checked={form.giro_code} onChange={(e) => set({ giro_code: e.target.checked })} />
          {t('settings.bizdocs_giro_code', { defaultValue: 'Print a SEPA payment QR code on EUR invoices' })}
        </label>
      </div>}

      {show('rates') && (
        <fieldset className="mb-4" data-testid="tax-rates">
          <legend className="mb-1 text-sm font-medium text-content-primary">
            {t('settings.bizdocs_rates', { defaultValue: 'Tax rates' })}
          </legend>
          {rates.length === 0 && (
            <p className="mb-2 text-sm text-content-secondary">
              {t('settings.bizdocs_rates_empty', { defaultValue: 'No tax rates yet. Add the rates you charge, for example Standard 19 and Reduced 7.' })}
            </p>
          )}
          {rates.map((r, i) => (
            <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
              <input aria-label={t('settings.bizdocs_rate_name', { defaultValue: 'Rate name' })} className={`${input} w-40`} disabled={!canEdit}
                value={r.name} onChange={(e) => setRate(i, { name: e.target.value })} />
              <input aria-label={t('settings.bizdocs_rate_percent', { defaultValue: 'Percent' })} type="number" min={0} max={100} step="0.1"
                className={`${input} w-24`} disabled={!canEdit} value={r.rate} onChange={(e) => setRate(i, { rate: Number(e.target.value) || 0 })} />
              <span className="text-sm text-content-secondary">%</span>
              <label className="flex items-center gap-1 text-sm text-content-primary">
                <input type="checkbox" disabled={!canEdit} checked={r.default} onChange={(e) => setRate(i, { default: e.target.checked })} />
                {t('settings.bizdocs_rate_default', { defaultValue: 'Default' })}
              </label>
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => set({ tax_rates: rates.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {canEdit && rates.length < 20 && (
            <Button size="sm" variant="secondary" onClick={() => set({ tax_rates: [...rates, { name: '', rate: 0, default: rates.length === 0 }] })}>
              {t('settings.bizdocs_rate_add', { defaultValue: 'Add tax rate' })}
            </Button>
          )}
        </fieldset>
      )}

      {show('texts') && <fieldset className="mb-4">
        <legend className="mb-1 text-sm font-medium text-content-primary">
          {t('settings.bizdocs_texts', { defaultValue: 'Default texts per document type' })}
        </legend>
        <div className="mb-2 flex flex-wrap gap-1">
          {DOC_TEXT_KINDS.map((k) => (
            <button key={k} type="button" onClick={() => setTextKind(k)}
              className={`rounded px-2 py-1 text-sm ${k === textKind ? 'bg-surface-secondary font-medium text-content-primary' : 'text-content-secondary'}`}>
              {t(`settings.bizdocs_kind_${k}`, { defaultValue: KIND_LABEL[k] })}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {DOC_TEXT_KEYS.map((key) => (
            <label key={key} className="text-xs text-content-tertiary">
              {t(`settings.bizdocs_text_${key}`, { defaultValue: KEY_LABEL[key] })}
              {key === 'email_subject' ? (
                <input className={input} disabled={!canEdit} value={form.document_texts[textKind]?.[key] ?? ''} onChange={(e) => setText(key, e.target.value)} />
              ) : (
                <textarea className={`${input} min-h-[72px]`} disabled={!canEdit} value={form.document_texts[textKind]?.[key] ?? ''} onChange={(e) => setText(key, e.target.value)} />
              )}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-content-tertiary">
          {t('settings.bizdocs_placeholders', { defaultValue: 'Empty fields use the built-in text in the document language. Placeholders:' })}{' '}
          <code>{PLACEHOLDERS}</code>
        </p>
        <div className="mt-3 rounded border border-border-light bg-surface-secondary p-3 text-sm" data-testid="template-preview">
          <div className="mb-1 text-xs font-medium uppercase text-content-tertiary">
            {t('settings.bizdocs_preview', { defaultValue: 'Preview with sample data' })}
          </div>
          {kindTexts.intro || kindTexts.closing || kindTexts.email_subject ? (
            <div className="space-y-1 text-content-primary">
              {kindTexts.email_subject && <div className="font-medium">{fillSample(kindTexts.email_subject, form.company_name)}</div>}
              {kindTexts.intro && <p className="whitespace-pre-line">{fillSample(kindTexts.intro, form.company_name)}</p>}
              {kindTexts.closing && <p className="whitespace-pre-line">{fillSample(kindTexts.closing, form.company_name)}</p>}
            </div>
          ) : (
            <p className="text-content-secondary">
              {t('settings.bizdocs_preview_empty', { defaultValue: 'No custom text for this document type yet - the built-in text is used.' })}
            </p>
          )}
        </div>
      </fieldset>}

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => save.mutate(form)} disabled={save.isPending}>
            <Save className="mr-1 h-4 w-4" />
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
          {msg && <span className="text-sm text-content-secondary">{msg}</span>}
        </div>
      )}
    </section>
  );
}
