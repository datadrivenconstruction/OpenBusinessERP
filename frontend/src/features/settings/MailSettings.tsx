/** Outbound mail (SMTP) settings card for the business settings hub, plus the shared "mail not set up" notice. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, Mail } from 'lucide-react';
import { apiGet, apiPost, apiPut, getErrorMessage } from '@/shared/lib/api';
import { Button } from '@/shared/ui/Button';

export interface MailStatus {
  configured: boolean;
  source: 'env' | 'settings' | 'none';
}

export interface MailSettingsData extends MailStatus {
  host: string;
  port: number;
  security: 'starttls' | 'ssl' | 'none';
  username: string;
  from_name: string;
  from_address: string;
  reply_to: string;
  password_set: boolean;
}

type MailSettingsUpdate = Partial<Omit<MailSettingsData, 'password_set' | 'configured' | 'source'>> & { password?: string };

const B = '/v1/business-settings/mail';
export const MAIL_SETTINGS_LINK = '/settings?tab=company#mail-settings';

export const mailApi = {
  status: () => apiGet<MailStatus>(`${B}/status/`),
  get: () => apiGet<MailSettingsData>(`${B}/`),
  put: (body: MailSettingsUpdate) => apiPut<MailSettingsData>(`${B}/`, body),
  test: (to: string) => apiPost<{ ok: boolean; backend: string; reason: string }>(`${B}/test/`, { to }),
};

export function useMailStatus() {
  return useQuery({ queryKey: ['mail-status'], queryFn: mailApi.status, staleTime: 60_000, retry: false });
}

/** Shown wherever the app would send mail but no SMTP transport is configured. */
export function MailNotConfigured({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 rounded border border-border-light bg-surface-secondary p-3 text-sm text-content-secondary" data-testid="mail-not-configured">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        <p>
          {t('mail.not_configured', {
            defaultValue: 'Outbound e-mail is not set up yet, so the app cannot send this message itself.',
          })}{' '}
          <Link to={MAIL_SETTINGS_LINK} className="font-medium text-oe-blue hover:underline">
            {t('mail.open_settings', { defaultValue: 'Set up e-mail' })}
          </Link>
        </p>
        {children}
      </div>
    </div>
  );
}

const input =
  'mt-1 w-full rounded border border-border-light bg-surface-primary px-2 py-1.5 text-sm text-content-primary focus:border-border focus:outline-none disabled:opacity-60';

export const MAIL_KEYWORDS = 'email e-mail mail smtp server outgoing sender test';

export function MailSettingsSection({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['mail-settings'], queryFn: mailApi.get, enabled: canEdit, retry: false });
  const [form, setForm] = useState<MailSettingsUpdate>({});
  const [password, setPassword] = useState('');
  const [testTo, setTestTo] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (data.data) {
      const { password_set: _p, configured: _c, source: _s, ...rest } = data.data;
      setForm(rest);
    }
  }, [data.data]);

  const done = (saved: MailSettingsData) => {
    qc.setQueryData(['mail-settings'], saved);
    void qc.invalidateQueries({ queryKey: ['mail-status'] });
  };
  const save = useMutation({
    mutationFn: () => mailApi.put({ ...form, ...(password ? { password } : {}) }),
    onSuccess: (saved) => {
      done(saved);
      setPassword('');
      setMsg({ ok: true, text: t('mail.saved', { defaultValue: 'Mail settings saved.' }) });
    },
    onError: (e) => setMsg({ ok: false, text: getErrorMessage(e) }),
  });
  const clearPassword = useMutation({ mutationFn: () => mailApi.put({ password: '' }), onSuccess: done });
  const test = useMutation({
    mutationFn: () => mailApi.test(testTo.trim()),
    onSuccess: (r) =>
      setMsg(
        r.ok
          ? { ok: true, text: t('mail.test_ok', { defaultValue: 'Test e-mail sent to {{to}}.', to: testTo.trim() }) }
          : { ok: false, text: t('mail.test_failed', { defaultValue: 'Test failed: {{reason}}', reason: r.reason }) },
      ),
    onError: (e) => setMsg({ ok: false, text: getErrorMessage(e) }),
  });

  const set = (patch: MailSettingsUpdate) => setForm((f) => ({ ...f, ...patch }));
  const env = data.data?.source === 'env';
  const locked = !canEdit || env;

  return (
    <section id="mail-settings" className="mb-6 rounded-md border border-border-light bg-surface-primary p-4" data-testid="mail-settings-section">
      <h2 className="flex items-center gap-2 text-base font-semibold text-content-primary">
        <Mail className="h-4 w-4" />
        {t('mail.title', { defaultValue: 'Outgoing e-mail (SMTP)' })}
      </h2>
      <p className="mb-3 text-sm text-content-secondary">
        {t('mail.desc', {
          defaultValue: 'Used to send quotes, invoices and payment reminders directly from the app. The password is stored encrypted.',
        })}
      </p>
      {!canEdit ? (
        <p className="text-sm text-content-tertiary">{t('mail.admin_only', { defaultValue: 'Only an administrator can change mail settings.' })}</p>
      ) : (
        <>
          {env && (
            <p className="mb-3 text-sm text-content-secondary">
              {t('mail.env_override', { defaultValue: 'Mail is configured by the server environment (SMTP_* variables); these fields are ignored.' })}
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-content-tertiary">
              {t('mail.host', { defaultValue: 'SMTP server' })}
              <input className={input} disabled={locked} value={form.host ?? ''} placeholder="smtp.example.com" onChange={(e) => set({ host: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-content-tertiary">
                {t('mail.port', { defaultValue: 'Port' })}
                <input className={input} disabled={locked} type="number" min={1} max={65535} value={form.port ?? 587}
                  onChange={(e) => set({ port: Number(e.target.value) || 587 })} />
              </label>
              <label className="text-xs text-content-tertiary">
                {t('mail.security', { defaultValue: 'Encryption' })}
                <select className={input} disabled={locked} value={form.security ?? 'starttls'}
                  onChange={(e) => {
                    const security = e.target.value as MailSettingsData['security'];
                    set({ security, port: security === 'ssl' ? 465 : security === 'starttls' ? 587 : form.port });
                  }}>
                  <option value="starttls">STARTTLS</option>
                  <option value="ssl">SSL/TLS</option>
                  <option value="none">{t('mail.security_none', { defaultValue: 'None' })}</option>
                </select>
              </label>
            </div>
            <label className="text-xs text-content-tertiary">
              {t('mail.username', { defaultValue: 'User name' })}
              <input className={input} disabled={locked} autoComplete="off" value={form.username ?? ''} onChange={(e) => set({ username: e.target.value })} />
            </label>
            <label className="text-xs text-content-tertiary">
              {t('mail.password', { defaultValue: 'Password' })}
              <input className={input} disabled={locked} type="password" autoComplete="new-password" value={password}
                placeholder={data.data?.password_set ? t('mail.password_kept', { defaultValue: '•••••• (unchanged)' }) : ''}
                onChange={(e) => setPassword(e.target.value)} />
              {data.data?.password_set && !locked && (
                <button type="button" className="mt-1 text-xs text-oe-blue hover:underline" onClick={() => clearPassword.mutate()}>
                  {t('mail.password_clear', { defaultValue: 'Remove stored password' })}
                </button>
              )}
            </label>
            <label className="text-xs text-content-tertiary">
              {t('mail.from_name', { defaultValue: 'Sender name' })}
              <input className={input} disabled={locked} value={form.from_name ?? ''} onChange={(e) => set({ from_name: e.target.value })} />
            </label>
            <label className="text-xs text-content-tertiary">
              {t('mail.from_address', { defaultValue: 'Sender address' })}
              <input className={input} disabled={locked} type="email" value={form.from_address ?? ''} onChange={(e) => set({ from_address: e.target.value })} />
            </label>
            <label className="text-xs text-content-tertiary">
              {t('mail.reply_to', { defaultValue: 'Reply-to address (optional)' })}
              <input className={input} disabled={locked} type="email" value={form.reply_to ?? ''} onChange={(e) => set({ reply_to: e.target.value })} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {!env && (
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                {t('mail.save', { defaultValue: 'Save mail settings' })}
              </Button>
            )}
            <label className="text-xs text-content-tertiary">
              {t('mail.test_to', { defaultValue: 'Send a test e-mail to' })}
              <input className={input} type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            </label>
            <Button size="sm" variant="secondary" disabled={test.isPending || !testTo.includes('@') || !data.data?.configured}
              onClick={() => { setMsg(null); test.mutate(); }}>
              {t('mail.test', { defaultValue: 'Send test e-mail' })}
            </Button>
          </div>
          {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-content-secondary' : 'text-content-primary'}`} role="status">{msg.text}</p>}
        </>
      )}
    </section>
  );
}
