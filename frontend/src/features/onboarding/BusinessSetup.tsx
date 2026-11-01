/**
 * Business setup: company -> tax -> bank -> documents -> mail -> first invoice.
 *
 * Every step is skippable; progress lives in business settings (`setup`) so the
 * flow resumes on any browser. Ends on the dashboard, where SetupChecklist lists
 * what was skipped.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';

import { Button, Input, Logo } from '@/shared/ui';
import { apiGet, apiPost, apiPut, getErrorMessage } from '@/shared/lib/api';
import { getCountry, sortedCountries } from '@/shared/lib/countries';
import { MailSettingsSection } from '@/features/settings/MailSettings';
import { fetchSalesPdf } from '@/features/sales/api';
import { fetchBusinessDemoCases, installBusinessDemoCase } from '@/features/business-demo/api';
import { fmtCurrency, fmtDate } from '@/shared/lib/formatters';

export const SETUP_STEPS = ['company', 'tax', 'bank', 'documents', 'mail', 'invoice'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export interface SetupState {
  step?: number;
  done?: SetupStep[];
  skipped?: SetupStep[];
  finished?: boolean;
}

interface TaxRate {
  name: string;
  rate: number;
  default: boolean;
}

export interface SettingsData {
  company_name: string;
  address: string;
  country_code: string;
  base_currency: string;
  fiscal_year_start_month: number;
  vat_id: string;
  iban: string;
  bic: string;
  bank_name: string;
  payment_terms_days: number;
  invoice_prefix: string;
  small_business: boolean;
  logo_data_url: string;
  tax_rates: TaxRate[];
  setup: SetupState;
}

export const SETTINGS_KEY = ['business-settings'] as const;
export const fetchSettings = () => apiGet<SettingsData>('/v1/business-settings/');

/** Country defaults: VAT rates, suggested chart and whether a small-business VAT exemption exists. */
const COUNTRY_TAX: Record<string, { rates: [string, number][]; chart?: string; smallBusiness?: string }> = {
  DE: { rates: [['Standard', 19], ['Reduced', 7]], chart: 'de_skr03', smallBusiness: '§ 19 UStG' },
  AT: { rates: [['Standard', 20], ['Reduced', 10]], smallBusiness: '§ 6 Abs. 1 Z 27 UStG' },
  CH: { rates: [['Standard', 8.1], ['Reduced', 2.6]] },
  FR: { rates: [['Standard', 20], ['Reduced', 5.5]], smallBusiness: 'Art. 293 B CGI' },
  IT: { rates: [['Standard', 22], ['Reduced', 10]] },
  ES: { rates: [['Standard', 21], ['Reduced', 10]] },
  NL: { rates: [['Standard', 21], ['Reduced', 9]] },
  PL: { rates: [['Standard', 23], ['Reduced', 8]] },
  GB: { rates: [['Standard', 20], ['Reduced', 5]] },
  US: { rates: [['Sales tax', 0]] },
};

export const suggestedChart = (country: string) => COUNTRY_TAX[country]?.chart ?? 'ifrs_generic';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Issuing posts to the GL, which needs an open period for today. */
export async function ensureFiscalYear(startMonth: number, today = new Date()) {
  const years = await apiGet<{ start_date: string; end_date: string }[]>('/v1/gl/fiscal-years/');
  const now = iso(today);
  if (years.some((y) => y.start_date <= now && now <= y.end_date)) return;
  const y = today.getMonth() + 1 >= startMonth ? today.getFullYear() : today.getFullYear() - 1;
  const start = new Date(y, startMonth - 1, 1);
  const end = new Date(y + 1, startMonth - 1, 0);
  await apiPost('/v1/gl/fiscal-years/', {
    name: startMonth === 1 ? `FY${y}` : `FY${y}/${String(y + 1).slice(2)}`,
    start_date: iso(start),
    end_date: iso(end),
  });
}

const EXAMPLE_LINES = [
  { description: 'Consulting (hours)', qty: 8, unit_price: 95 },
  { description: 'Setup fee', qty: 1, unit_price: 250 },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-content-secondary">{label}</span>
      {children}
    </label>
  );
}

const textareaCls =
  'w-full rounded-lg border border-border-light bg-surface-elevated px-3 py-2 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-oe-blue/40';

export function BusinessSetup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const settingsQuery = useQuery({ queryKey: SETTINGS_KEY, queryFn: fetchSettings, retry: false });
  const [form, setForm] = useState<SettingsData | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chart, setChart] = useState('ifrs_generic');
  const [bank, setBank] = useState({ name: '', opening_balance: '' });
  const [customer, setCustomer] = useState({ name: '', email: '', address: '' });
  const [lines, setLines] = useState(EXAMPLE_LINES);
  const [invoice, setInvoice] = useState<{ id: string; number: string | null; status: string } | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    const key = SETUP_STEPS[step] ?? 'company';
    document.title = `${t(`bizsetup.${key}_title`)} | OpenBusinessERP`;
  }, [step, t]);

  useEffect(() => {
    const data = settingsQuery.data;
    if (!data || form) return;
    const country = data.country_code;
    setForm({
      ...data,
      tax_rates: data.tax_rates.length
        ? data.tax_rates
        : (COUNTRY_TAX[country]?.rates ?? [['Standard', 20]]).map(([name, rate], i) => ({ name, rate, default: i === 0 })),
    });
    setChart(suggestedChart(country));
    setBank((b) => ({ ...b, name: data.bank_name || 'Business account' }));
    const wanted = Number(params.get('step'));
    setStep(Number.isInteger(wanted) && wanted >= 0 && wanted < SETUP_STEPS.length && params.has('step') ? wanted : data.setup?.step ?? 0);
  }, [settingsQuery.data, form, params]);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const patch = useCallback((p: Partial<SettingsData>) => setForm((f) => (f ? { ...f, ...p } : f)), []);
  const smallBusinessLaw = form ? COUNTRY_TAX[form.country_code]?.smallBusiness : undefined;
  const countries = useMemo(() => sortedCountries(), []);

  const saveProgress = useCallback(
    async (key: SetupStep, outcome: 'done' | 'skipped', extra: Partial<SettingsData> = {}) => {
      const prev = form?.setup ?? {};
      const done = new Set(prev.done ?? []);
      const skipped = new Set(prev.skipped ?? []);
      if (outcome === 'done') { done.add(key); skipped.delete(key); } else if (!done.has(key)) skipped.add(key);
      const idx = SETUP_STEPS.indexOf(key);
      const finished = idx === SETUP_STEPS.length - 1 || !!prev.finished;
      const setup: SetupState = { step: finished ? idx : idx + 1, done: [...done], skipped: [...skipped], finished };
      const saved = await apiPut<SettingsData>('/v1/business-settings/', { ...extra, setup });
      setForm((f) => (f ? { ...f, ...extra, setup: saved.setup } : f));
      qc.setQueryData(SETTINGS_KEY, saved);
      if (finished) navigate('/dashboard');
      else setStep(idx + 1);
    },
    [form, navigate, qc],
  );

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!form) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-primary">
        <Loader2 className="animate-spin text-content-tertiary" />
      </div>
    );
  }

  const key = SETUP_STEPS[step] ?? 'company';
  const currency = form.base_currency || 'EUR';

  const saveCompany = () =>
    run(async () => {
      await apiPost(`/v1/gl/templates/${chart}/load/`, {});
      await ensureFiscalYear(settingsQuery.data?.fiscal_year_start_month ?? 1);
      await saveProgress('company', 'done', {
        company_name: form.company_name,
        address: form.address,
        country_code: form.country_code,
        base_currency: form.base_currency,
      });
    });

  const saveTax = () =>
    run(() =>
      saveProgress('tax', 'done', {
        vat_id: form.vat_id,
        small_business: form.small_business,
        tax_rates: form.small_business ? [{ name: 'Exempt', rate: 0, default: true }] : form.tax_rates,
      }),
    );

  const saveBank = () =>
    run(async () => {
      if (form.iban) {
        await apiPost('/v1/banking/accounts/', {
          name: bank.name || 'Business account',
          iban: form.iban,
          bic: form.bic,
          currency,
          opening_balance: Number(bank.opening_balance) || 0,
        });
      }
      await saveProgress('bank', 'done', { iban: form.iban, bic: form.bic, bank_name: bank.name });
    });

  const saveDocuments = () =>
    run(() =>
      saveProgress('documents', 'done', {
        logo_data_url: form.logo_data_url,
        payment_terms_days: form.payment_terms_days,
        invoice_prefix: form.invoice_prefix,
      }),
    );

  const onLogo = (file: File | undefined) => {
    if (!file || !/^image\/(png|jpeg)$/.test(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => patch({ logo_data_url: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const createInvoice = () =>
    run(async () => {
      const name = customer.name.trim() || 'Example Customer Ltd';
      const contact = await apiPost<{ id: string }>('/v1/contacts/', {
        contact_type: 'customer',
        company_name: name,
        primary_email: customer.email.trim() || null,
        country_code: form.country_code || null,
      });
      const due = new Date(Date.now() + form.payment_terms_days * 86_400_000).toISOString().slice(0, 10);
      const doc = await apiPost<{ id: string; number: string | null; status: string }>('/v1/sales/invoices/', {
        customer_id: contact.id,
        customer_name: name,
        customer_email: customer.email.trim(),
        customer_address: customer.address,
        currency,
        due_date: due,
        tax_note: form.small_business && smallBusinessLaw ? `VAT exempt (${smallBusinessLaw})` : '',
        lines: lines.map((l) => ({ ...l, tax_rate: form.small_business ? 0 : null })),
      });
      setInvoice(doc);
      const blob = await fetchSalesPdf('invoices', doc.id);
      setPdfUrl(URL.createObjectURL(blob));
    });

  const issueInvoice = () =>
    run(async () => {
      if (!invoice) return;
      const doc = await apiPost<{ id: string; number: string | null; status: string }>(`/v1/sales/invoices/${invoice.id}/issue/`, {});
      setInvoice(doc);
      const blob = await fetchSalesPdf('invoices', doc.id);
      setPdfUrl(URL.createObjectURL(blob));
    });

  const loadDemo = () =>
    run(async () => {
      const cases = await fetchBusinessDemoCases();
      const pick = cases.find((c) => !c.installed) ?? cases[0];
      if (pick && !pick.installed) await installBusinessDemoCase(pick.key);
      const saved = await apiPut<SettingsData>('/v1/business-settings/', {
        setup: { ...form.setup, finished: true },
      });
      qc.setQueryData(SETTINGS_KEY, saved);
      await qc.invalidateQueries();
      navigate('/dashboard');
    });

  const title: Record<SetupStep, string> = {
    company: t('bizsetup.company_title', { defaultValue: 'Your company' }),
    tax: t('bizsetup.tax_title', { defaultValue: 'Tax and VAT' }),
    bank: t('bizsetup.bank_title', { defaultValue: 'Bank account' }),
    documents: t('bizsetup.documents_title', { defaultValue: 'Logo and document defaults' }),
    mail: t('bizsetup.mail_title', { defaultValue: 'Outgoing mail' }),
    invoice: t('bizsetup.invoice_title', { defaultValue: 'First customer and invoice' }),
  };

  const primary: Record<SetupStep, () => void> = {
    company: saveCompany,
    tax: saveTax,
    bank: saveBank,
    documents: saveDocuments,
    mail: () => run(() => saveProgress('mail', 'done')),
    invoice: () => run(() => saveProgress('invoice', invoice?.status === 'issued' ? 'done' : 'skipped')),
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface-primary" data-testid="business-setup">
      <header className="border-b border-border-light">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-4 px-6 py-4">
          <Logo size="sm" />
          <ol className="flex flex-1 flex-wrap gap-1.5" aria-label={t('bizsetup.progress', { defaultValue: 'Setup progress' })}>
            {SETUP_STEPS.map((s, i) => {
              const done = form.setup?.done?.includes(s);
              return (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => setStep(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className={clsx(
                      'flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-medium',
                      i === step ? 'bg-oe-blue text-white' : done ? 'bg-semantic-success-bg text-semantic-success' : 'bg-surface-secondary text-content-secondary',
                    )}
                  >
                    {done && <Check size={10} />}
                    {i + 1}. {title[s]}
                  </button>
                </li>
              );
            })}
          </ol>
          <Button variant="ghost" size="sm" onClick={loadDemo} disabled={busy} data-testid="setup-load-demo">
            {t('bizsetup.load_demo', { defaultValue: 'Load demo company instead' })}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-6 py-8">
        <h1 className="text-2xl font-semibold text-content-primary">{title[key]}</h1>

        {key === 'company' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('bizsetup.company_name', { defaultValue: 'Company name' })}>
              <Input value={form.company_name} onChange={(e) => patch({ company_name: e.target.value })} data-testid="setup-company-name" />
            </Field>
            <Field label={t('bizsetup.country', { defaultValue: 'Country' })}>
              <select
                className={textareaCls}
                value={form.country_code}
                data-testid="setup-country"
                onChange={(e) => {
                  const code = e.target.value;
                  const c = getCountry(code);
                  patch({
                    country_code: code,
                    base_currency: c?.currency ?? form.base_currency,
                    tax_rates: (COUNTRY_TAX[code]?.rates ?? [['Standard', 20]]).map(([name, rate], i) => ({ name, rate, default: i === 0 })),
                    small_business: false,
                  });
                  setChart(suggestedChart(code));
                }}
              >
                <option value="">—</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label={t('bizsetup.address', { defaultValue: 'Address' })}>
              <textarea rows={3} className={textareaCls} value={form.address} onChange={(e) => patch({ address: e.target.value })} />
            </Field>
            <div className="space-y-4">
              <Field label={t('bizsetup.currency', { defaultValue: 'Currency' })}>
                <Input value={form.base_currency} maxLength={3} onChange={(e) => patch({ base_currency: e.target.value.toUpperCase() })} />
              </Field>
              <Field label={t('bizsetup.chart', { defaultValue: 'Chart of accounts' })}>
                <select className={textareaCls} value={chart} onChange={(e) => setChart(e.target.value)} data-testid="setup-chart">
                  <option value="ifrs_generic">{t('bizsetup.chart_ifrs', { defaultValue: 'IFRS (international)' })}</option>
                  <option value="de_skr03">{t('bizsetup.chart_skr03', { defaultValue: 'SKR03 (Germany)' })}</option>
                </select>
              </Field>
              <p className="text-2xs text-content-tertiary">
                {t('bizsetup.number_format', { defaultValue: 'Numbers and dates: {{sample}}', sample: `${fmtCurrency(1234.5, /^[A-Z]{3}$/.test(form.base_currency) ? form.base_currency : 'EUR')} · ${fmtDate(new Date().toISOString().slice(0, 10))}` })}
              </p>
            </div>
          </div>
        )}

        {key === 'tax' && (
          <div className="space-y-4">
            <Field label={t('bizsetup.vat_id', { defaultValue: 'VAT ID' })}>
              <Input value={form.vat_id} onChange={(e) => patch({ vat_id: e.target.value })} />
            </Field>
            {smallBusinessLaw && (
              <label className="flex items-start gap-2 text-sm text-content-primary">
                <input type="checkbox" checked={form.small_business} onChange={(e) => patch({ small_business: e.target.checked })} data-testid="setup-small-business" />
                <span>
                  {t('bizsetup.small_business', { defaultValue: 'Small business: no VAT on invoices ({{law}})', law: smallBusinessLaw })}
                </span>
              </label>
            )}
            {!form.small_business && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-content-secondary">{t('bizsetup.rates', { defaultValue: 'VAT rates' })}</p>
                {form.tax_rates.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={r.name} onChange={(e) => patch({ tax_rates: form.tax_rates.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                    <Input type="number" className="w-24" value={r.rate} onChange={(e) => patch({ tax_rates: form.tax_rates.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) } : x)) })} />
                    <label className="flex items-center gap-1 text-2xs text-content-secondary">
                      <input type="radio" checked={r.default} onChange={() => patch({ tax_rates: form.tax_rates.map((x, j) => ({ ...x, default: j === i })) })} />
                      {t('bizsetup.rate_default', { defaultValue: 'Default' })}
                    </label>
                    <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} aria-label={t('bizsetup.remove', { defaultValue: 'Remove' })} onClick={() => patch({ tax_rates: form.tax_rates.filter((_, j) => j !== i) })} />
                  </div>
                ))}
                <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => patch({ tax_rates: [...form.tax_rates, { name: '', rate: 0, default: false }] })}>
                  {t('bizsetup.add_rate', { defaultValue: 'Add rate' })}
                </Button>
              </div>
            )}
          </div>
        )}

        {key === 'bank' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('bizsetup.bank_name', { defaultValue: 'Account name' })}>
              <Input value={bank.name} onChange={(e) => setBank({ ...bank, name: e.target.value })} />
            </Field>
            <Field label="IBAN">
              <Input value={form.iban} onChange={(e) => patch({ iban: e.target.value.replace(/\s+/g, '').toUpperCase() })} data-testid="setup-iban" />
            </Field>
            <Field label="BIC">
              <Input value={form.bic} onChange={(e) => patch({ bic: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={t('bizsetup.opening_balance', { defaultValue: 'Opening balance (optional)' })}>
              <Input type="number" value={bank.opening_balance} onChange={(e) => setBank({ ...bank, opening_balance: e.target.value })} />
            </Field>
            <p className="text-2xs text-content-tertiary sm:col-span-2">
              {t('bizsetup.bank_hint', { defaultValue: 'With an IBAN, invoices carry an EPC QR code so customers can pay by scanning it.' })}
            </p>
          </div>
        )}

        {key === 'documents' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('bizsetup.logo', { defaultValue: 'Logo (PNG or JPEG)' })}>
              <input type="file" accept="image/png,image/jpeg" onChange={(e) => onLogo(e.target.files?.[0])} className="text-sm" />
              {form.logo_data_url && <img src={form.logo_data_url} alt="" className="mt-2 h-12 object-contain" />}
            </Field>
            <div className="space-y-4">
              <Field label={t('bizsetup.payment_terms', { defaultValue: 'Payment terms (days)' })}>
                <Input type="number" value={form.payment_terms_days} onChange={(e) => patch({ payment_terms_days: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} />
              </Field>
              <Field label={t('bizsetup.invoice_prefix', { defaultValue: 'Invoice number prefix' })}>
                <Input value={form.invoice_prefix} maxLength={10} placeholder="INV" onChange={(e) => patch({ invoice_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} data-testid="setup-prefix" />
              </Field>
              <p className="text-2xs text-content-tertiary">
                {t('bizsetup.next_number', { defaultValue: 'Next invoice: {{number}}', number: `${form.invoice_prefix || 'INV'}-000001` })}
              </p>
            </div>
          </div>
        )}

        {key === 'mail' && <MailSettingsSection canEdit />}

        {key === 'invoice' && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('bizsetup.customer_name', { defaultValue: 'Customer name' })}>
                <Input value={customer.name} placeholder="Example Customer Ltd" onChange={(e) => setCustomer({ ...customer, name: e.target.value })} data-testid="setup-customer" />
              </Field>
              <Field label={t('bizsetup.customer_email', { defaultValue: 'Customer email' })}>
                <Input value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
              </Field>
              <Field label={t('bizsetup.customer_address', { defaultValue: 'Customer address' })}>
                <textarea rows={2} className={textareaCls} value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
              </Field>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={l.description} disabled={!!invoice} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                  <Input type="number" className="w-20" value={l.qty} disabled={!!invoice} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
                  <Input type="number" className="w-28" value={l.unit_price} disabled={!!invoice} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit_price: Number(e.target.value) } : x)))} />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!invoice && (
                <Button variant="secondary" onClick={createInvoice} disabled={busy} data-testid="setup-preview">
                  {t('bizsetup.preview', { defaultValue: 'Create draft and preview PDF' })}
                </Button>
              )}
              {invoice && invoice.status !== 'issued' && (
                <Button variant="primary" onClick={issueInvoice} disabled={busy} data-testid="setup-issue">
                  {t('bizsetup.issue', { defaultValue: 'Issue invoice' })}
                </Button>
              )}
              {invoice?.status === 'issued' && (
                <span className="text-sm text-semantic-success" data-testid="setup-issued">
                  {t('bizsetup.issued', { defaultValue: 'Invoice {{number}} issued and posted.', number: invoice.number ?? '' })}
                </span>
              )}
            </div>
            {pdfUrl && <iframe title="PDF" src={pdfUrl} className="h-[480px] w-full rounded-lg border border-border-light" />}
          </div>
        )}

        {error && <p className="text-sm text-semantic-error" role="alert">{error}</p>}
      </main>

      <footer className="border-t border-border-light">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6">
          <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>
            {t('bizsetup.back', { defaultValue: 'Back' })}
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => run(() => saveProgress(key, 'skipped'))} data-testid="setup-skip">
              {t('bizsetup.skip', { defaultValue: 'Skip for now' })}
            </Button>
            <Button variant="primary" disabled={busy} onClick={primary[key]} data-testid="setup-next">
              {busy && <Loader2 size={14} className="mr-1 animate-spin" />}
              {key === 'invoice'
                ? t('bizsetup.finish', { defaultValue: 'Go to dashboard' })
                : t('bizsetup.save_next', { defaultValue: 'Save and continue' })}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}

const CHECK_LINKS: Record<SetupStep, string> = {
  company: 'bizsetup.company_title',
  tax: 'bizsetup.tax_title',
  bank: 'bizsetup.bank_title',
  documents: 'bizsetup.documents_title',
  mail: 'bizsetup.mail_title',
  invoice: 'bizsetup.invoice_title',
};

const CHECK_DEFAULTS: Record<SetupStep, string> = {
  company: 'Your company',
  tax: 'Tax and VAT',
  bank: 'Bank account',
  documents: 'Logo and document defaults',
  mail: 'Outgoing mail',
  invoice: 'First customer and invoice',
};

/** Dashboard card listing the setup steps that are still open; hidden once all are done. */
export function SetupChecklist() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: SETTINGS_KEY, queryFn: fetchSettings, retry: false });
  if (!data) return null;
  const done = new Set(data.setup?.done ?? []);
  if (SETUP_STEPS.every((s) => done.has(s))) return null;
  return (
    <section className="rounded-2xl border border-border-light bg-surface-elevated px-5 py-4" data-testid="setup-checklist">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-content-primary">{t('bizsetup.checklist_title', { defaultValue: 'Finish setting up' })}</h2>
        <span className="text-2xs text-content-tertiary">
          {t('bizsetup.checklist_count', { defaultValue: '{{done}} of {{total}} done', done: done.size, total: SETUP_STEPS.length })}
        </span>
      </div>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {SETUP_STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              disabled={done.has(s)}
              onClick={() => navigate(`/setup?step=${i}`)}
              className={clsx('flex items-center gap-2 text-sm', done.has(s) ? 'text-content-tertiary line-through' : 'text-oe-blue-text hover:underline')}
            >
              {done.has(s) ? <Check size={14} /> : <span className="h-3.5 w-3.5 rounded-full border border-current" />}
              {t(CHECK_LINKS[s], { defaultValue: CHECK_DEFAULTS[s] })}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
