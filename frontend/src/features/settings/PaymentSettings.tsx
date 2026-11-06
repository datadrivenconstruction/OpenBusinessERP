/** Online payment provider (Stripe / Mollie) settings card for the business settings hub. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CreditCard } from 'lucide-react';
import { apiGet, apiPost, apiPut, getErrorMessage } from '@/shared/lib/api';
import { Button } from '@/shared/ui/Button';

type Provider = 'none' | 'stripe' | 'mollie';
type SecretKey = 'stripe_secret_key' | 'stripe_webhook_secret' | 'mollie_api_key';

export interface PaymentSettingsData {
  provider: Provider;
  public_base_url: string;
  return_url: string;
  clearing_account_code: string;
  stripe_secret_key_set: boolean;
  stripe_webhook_secret_set: boolean;
  mollie_api_key_set: boolean;
  configured: boolean;
  test_mode: boolean | null;
}

type Form = Pick<PaymentSettingsData, 'provider' | 'public_base_url' | 'return_url' | 'clearing_account_code'>;
type Update = Partial<Form> & Partial<Record<SecretKey, string>>;

const B = '/v1/business-settings/payments';
const api = {
  get: () => apiGet<PaymentSettingsData>(`${B}/`),
  put: (body: Update) => apiPut<PaymentSettingsData>(`${B}/`, body),
  test: () => apiPost<{ ok: boolean; provider: string; test_mode: boolean | null; reason: string }>(`${B}/test/`, {}),
};

export const PAYMENT_KEYWORDS = 'payment online stripe mollie card checkout link webhook pay';

const input =
  'mt-1 w-full rounded border border-border-light bg-surface-primary px-2 py-1.5 text-sm text-content-primary focus:border-border focus:outline-none disabled:opacity-60';

export function PaymentSettingsSection({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['payment-settings'], queryFn: api.get, enabled: canEdit, retry: false });
  const [form, setForm] = useState<Form>({ provider: 'none', public_base_url: '', return_url: '', clearing_account_code: '' });
  const [secrets, setSecrets] = useState<Partial<Record<SecretKey, string>>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (data.data) {
      const { provider, public_base_url, return_url, clearing_account_code } = data.data;
      setForm({ provider, public_base_url, return_url, clearing_account_code });
    }
  }, [data.data]);

  const save = useMutation({
    mutationFn: () => {
      const filled = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v));
      return api.put({ ...form, ...filled });
    },
    onSuccess: (saved) => {
      qc.setQueryData(['payment-settings'], saved);
      setSecrets({});
      setMsg({ ok: true, text: t('payments.saved', { defaultValue: 'Payment settings saved.' }) });
    },
    onError: (e) => setMsg({ ok: false, text: getErrorMessage(e) }),
  });
  const test = useMutation({
    mutationFn: api.test,
    onSuccess: (r) =>
      setMsg(
        r.ok
          ? { ok: true, text: t('payments.test_ok', { defaultValue: 'Connection to the provider works.' }) }
          : { ok: false, text: t('payments.test_failed', { defaultValue: 'Connection failed: {{reason}}', reason: r.reason }) },
      ),
    onError: (e) => setMsg({ ok: false, text: getErrorMessage(e) }),
  });

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const secretField = (key: SecretKey, label: string) => (
    <label className="text-xs text-content-tertiary">
      {label}
      <input className={input} type="password" autoComplete="new-password" value={secrets[key] ?? ''}
        placeholder={data.data?.[`${key}_set`] ? t('payments.secret_kept', { defaultValue: '•••••• (unchanged)' }) : ''}
        onChange={(e) => setSecrets((s) => ({ ...s, [key]: e.target.value }))} />
    </label>
  );
  const mode = data.data?.test_mode;
  const webhook = form.public_base_url ? `${form.public_base_url.replace(/\/$/, '')}/api/v1/sales/payment-webhooks/${form.provider}/` : '';

  return (
    <section id="payment-settings" className="mb-6 rounded-md border border-border-light bg-surface-primary p-4" data-testid="payment-settings-section">
      <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-content-primary">
        <CreditCard className="h-4 w-4" />
        {t('payments.title', { defaultValue: 'Online payments' })}
        {data.data?.configured && mode !== null && mode !== undefined && (
          <span className="rounded border border-border-light px-1.5 py-0.5 text-xs font-normal text-content-secondary" data-testid="payment-mode">
            {mode ? t('payments.mode_test', { defaultValue: 'Test mode' }) : t('payments.mode_live', { defaultValue: 'Live mode' })}
          </span>
        )}
      </h2>
      <p className="mb-3 text-sm text-content-secondary">
        {t('payments.desc', {
          defaultValue: 'Adds a pay-online link to sent invoices (e-mail and PDF). Paid invoices are booked automatically to the clearing account. Keys are stored encrypted.',
        })}
      </p>
      {!canEdit ? (
        <p className="text-sm text-content-tertiary">{t('payments.admin_only', { defaultValue: 'Only an administrator can change payment settings.' })}</p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-content-tertiary">
              {t('payments.provider', { defaultValue: 'Provider' })}
              <select className={input} value={form.provider} onChange={(e) => set({ provider: e.target.value as Provider })}>
                <option value="none">{t('payments.provider_none', { defaultValue: 'Off' })}</option>
                <option value="stripe">Stripe</option>
                <option value="mollie">Mollie</option>
              </select>
            </label>
            <label className="text-xs text-content-tertiary">
              {t('payments.clearing_account', { defaultValue: 'Clearing account (GL code, optional)' })}
              <input className={input} value={form.clearing_account_code} placeholder="1360"
                onChange={(e) => set({ clearing_account_code: e.target.value })} />
            </label>
            {form.provider === 'stripe' && secretField('stripe_secret_key', t('payments.stripe_key', { defaultValue: 'Stripe secret key' }))}
            {form.provider === 'stripe' && secretField('stripe_webhook_secret', t('payments.stripe_webhook_secret', { defaultValue: 'Stripe webhook signing secret' }))}
            {form.provider === 'mollie' && secretField('mollie_api_key', t('payments.mollie_key', { defaultValue: 'Mollie API key' }))}
            <label className="text-xs text-content-tertiary">
              {t('payments.public_base_url', { defaultValue: 'Public address of this app' })}
              <input className={input} type="url" value={form.public_base_url} placeholder="https://erp.example.com"
                onChange={(e) => set({ public_base_url: e.target.value })} />
            </label>
            <label className="text-xs text-content-tertiary">
              {t('payments.return_url', { defaultValue: 'Page shown after payment (optional)' })}
              <input className={input} type="url" value={form.return_url} onChange={(e) => set({ return_url: e.target.value })} />
            </label>
          </div>
          {webhook && form.provider !== 'none' && (
            <p className="mt-2 break-all text-xs text-content-tertiary">
              {t('payments.webhook_hint', { defaultValue: 'Webhook address:' })} <code>{webhook}</code>
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {t('payments.save', { defaultValue: 'Save payment settings' })}
            </Button>
            <Button size="sm" variant="secondary" disabled={test.isPending || !data.data?.configured}
              onClick={() => { setMsg(null); test.mutate(); }}>
              {t('payments.test', { defaultValue: 'Test connection' })}
            </Button>
          </div>
          {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-content-secondary' : 'text-content-primary'}`} role="status">{msg.text}</p>}
        </>
      )}
    </section>
  );
}
