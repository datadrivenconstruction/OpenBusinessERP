import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/Button';
import { appointmentsApi, embedSnippet, type AppointmentSettings } from '../api';
import { useClientLabel } from '../clientLabel';
import { RemindersPanel } from './RemindersPanel';

const input = 'h-9 rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';

function useErr() {
  const [err, setErr] = useState('');
  return [err, (e: unknown) => setErr(e instanceof Error ? e.message : String(e)), () => setErr('')] as const;
}

// ── Online booking, reminders, privacy ───────────────────────────────────
export function OnlineBookingPanel({ settings }: { settings: AppointmentSettings }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const clientLabel = useClientLabel();
  const [form, setForm] = useState(settings);
  const [err, onErr, clearErr] = useErr();
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => setForm(settings), [settings]);
  const save = useMutation({
    mutationFn: () => {
      const { slug: _slug, ...body } = form;
      return appointmentsApi.updateSettings(body);
    },
    onSuccess: () => {
      clearErr();
      setMsg(t('appointments.saved', { defaultValue: 'Saved' }));
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: onErr,
  });
  const regen = useMutation({
    mutationFn: appointmentsApi.regenerateLink,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const link = `${origin}/book/${settings.slug}`;
  const field = (k: keyof AppointmentSettings, v: unknown) => setForm({ ...form, [k]: v });

  const exportClient = async () => {
    try {
      const rows = await appointmentsApi.clientBookings(email);
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bookings-${email}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      onErr(e);
    }
  };
  const eraseClient = async () => {
    if (!window.confirm(t('appointments.confirm_erase', { defaultValue: 'Delete all bookings of this person permanently?' }))) return;
    try {
      const r = await appointmentsApi.eraseClient(email);
      setMsg(t('appointments.erased', { defaultValue: '{{count}} bookings deleted', count: r.count }));
      qc.invalidateQueries({ queryKey: ['appointments'] });
    } catch (e) {
      onErr(e);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3 rounded-xl border border-border-light bg-surface-elevated p-4">
        <h3 className="font-semibold">{t('appointments.online_booking', { defaultValue: 'Online booking' })}</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.online_enabled} onChange={(e) => field('online_enabled', e.target.checked)} />
          {t('appointments.online_enabled', { defaultValue: 'Public booking page is on' })}
        </label>
        <label className="block text-xs">
          {t('appointments.public_title', { defaultValue: 'Name shown on the booking page' })}
          <input className={`${input} mt-1 w-full`} value={form.public_title} onChange={(e) => field('public_title', e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.auto_confirm} onChange={(e) => field('auto_confirm', e.target.checked)} />
          {t('appointments.auto_confirm', { defaultValue: 'Confirm online bookings automatically (otherwise they arrive as requests)' })}
        </label>
        <label className="block text-xs">
          {t('appointments.privacy_url', { defaultValue: 'Privacy policy link (shown next to the consent checkbox)' })}
          <input type="url" className={`${input} mt-1 w-full`} value={form.privacy_url} onChange={(e) => field('privacy_url', e.target.value)} placeholder="https://" />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs">
            {t('appointments.slot_step', { defaultValue: 'Slot grid (min)' })}
            <input type="number" min={5} className={`${input} mt-1 w-full`} value={form.slot_step_min} onChange={(e) => field('slot_step_min', Number(e.target.value))} />
          </label>
          <label className="text-xs">
            {t('appointments.min_notice', { defaultValue: 'Min. notice (h)' })}
            <input type="number" min={0} className={`${input} mt-1 w-full`} value={form.min_notice_hours} onChange={(e) => field('min_notice_hours', Number(e.target.value))} />
          </label>
          <label className="text-xs">
            {t('appointments.max_days', { defaultValue: 'Book ahead (days)' })}
            <input type="number" min={1} className={`${input} mt-1 w-full`} value={form.max_days_ahead} onChange={(e) => field('max_days_ahead', Number(e.target.value))} />
          </label>
        </div>
        <div className="space-y-2 rounded-md bg-surface-secondary p-3 text-xs">
          <p className="font-medium">{t('appointments.your_link', { defaultValue: 'Your booking link' })}</p>
          <code className="block break-all">{link}</code>
          <p className="font-medium">{t('appointments.embed', { defaultValue: 'Embed on your website' })}</p>
          <textarea readOnly rows={3} className={`${input} h-auto py-2 w-full font-mono text-2xs`} value={embedSnippet(origin, settings.slug)} />
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(link)}>
              {t('appointments.copy_link', { defaultValue: 'Copy link' })}
            </Button>
            {settings.online_enabled && (
              <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium text-oe-blue hover:underline">
                {t('appointments.preview_page', { defaultValue: 'Preview page' })}
              </a>
            )}
            <Button size="sm" variant="ghost" onClick={() => regen.mutate()}>
              {t('appointments.new_link', { defaultValue: 'Create a new link (old one stops working)' })}
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border-light bg-surface-elevated p-4">
        <h3 className="font-semibold">{t('appointments.reminders', { defaultValue: 'Reminders' })}</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.reminders_enabled} onChange={(e) => field('reminders_enabled', e.target.checked)} />
          {t('appointments.reminders_enabled_drafts', { defaultValue: 'Prepare reminder drafts for confirmed bookings' })}
        </label>
        <label className="block text-xs">
          {t('appointments.reminder_hours', { defaultValue: 'Hours before the appointment' })}
          <input type="number" min={1} className={`${input} mt-1 w-32`} value={form.reminder_hours} onChange={(e) => field('reminder_hours', Number(e.target.value))} />
        </label>
        <p className="text-xs text-content-secondary">
          {t('appointments.reminders_hint_drafts', { defaultValue: 'Off by default. Due reminders become drafts below; nothing is ever sent automatically. You send each one yourself and mark it as sent.' })}
        </p>
        <RemindersPanel enabled={settings.reminders_enabled} />

        <h3 className="pt-3 font-semibold">{t('appointments.privacy', { defaultValue: 'Privacy & data' })}</h3>
        <label className="block text-xs">
          {t('appointments.retention_days', { defaultValue: 'Delete bookings older than (days, 0 = keep)' })}
          <input type="number" min={0} className={`${input} mt-1 w-32`} value={form.retention_days} onChange={(e) => field('retention_days', Number(e.target.value))} />
        </label>
        <Button size="sm" variant="ghost" onClick={() => appointmentsApi.purge().then((r) => setMsg(t('appointments.erased', { defaultValue: '{{count}} bookings deleted', count: r.count })), onErr)}>
          {t('appointments.purge_now', { defaultValue: 'Apply retention now' })}
        </Button>
        <p className="text-xs">{t('appointments.client_data', { defaultValue: '{{client}} data request (by email)', client: clientLabel })}</p>
        <div className="flex flex-wrap gap-2">
          <input type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          <Button size="sm" variant="secondary" onClick={exportClient} disabled={!email}>{t('appointments.export', { defaultValue: 'Export' })}</Button>
          <Button size="sm" variant="danger" onClick={eraseClient} disabled={!email}>{t('appointments.erase', { defaultValue: 'Delete bookings' })}</Button>
        </div>
      </section>

      <div className="flex items-center gap-3 lg:col-span-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{t('common.save', { defaultValue: 'Save' })}</Button>
        {msg && <span className="text-sm text-content-secondary">{msg}</span>}
        {err && <span className="text-sm text-red-600" role="alert">{err}</span>}
      </div>
    </div>
  );
}
