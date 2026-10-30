import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Button } from '@/shared/ui';
import { ContactSearchInput } from '@/shared/ui/ContactSearchInput';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { getErrorMessage } from '@/shared/lib/api';
import { appointmentsApi, dayKey, parseLocal, toLocalIso, type Booking, type Resource, type Service } from '../api';
import { useClientLabel } from '../clientLabel';
import { blockMinutes } from '../scheduling';

const input = 'h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';
const label = 'block text-xs font-medium text-content-secondary mb-1';

interface Props {
  existing?: Booking;
  resourceId?: string;
  start?: Date;
  services: Service[];
  resources: Resource[];
  onSaved: () => void;
  onDelete?: () => void;
}

export function BookingForm({ existing, resourceId: initialResource, start: initialStart, services, resources, onSaved, onDelete }: Props) {
  const { t, i18n } = useTranslation();
  const clientLabel = useClientLabel();
  const activeServices = services.filter((s) => s.active || s.id === existing?.service_id);
  const [serviceId, setServiceId] = useState(existing?.service_id ?? activeServices[0]?.id ?? '');
  const [resourceId, setResourceId] = useState(existing?.resource_id ?? initialResource ?? '');
  const [start, setStart] = useState(
    existing ? existing.start_at.slice(0, 16) : initialStart ? toLocalIso(initialStart).slice(0, 16) : '',
  );
  const [contactId, setContactId] = useState(existing?.contact_id ?? '');
  const [contactName, setContactName] = useState('');
  const [name, setName] = useState(existing?.client_name ?? '');
  const [email, setEmail] = useState(existing?.client_email ?? '');
  const [phone, setPhone] = useState(existing?.client_phone ?? '');
  const [saveContact, setSaveContact] = useState(false);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [status, setStatus] = useState<'requested' | 'confirmed'>('confirmed');
  const [repeat, setRepeat] = useState(0);
  const [error, setError] = useState('');

  const service = services.find((s) => s.id === serviceId);
  const fitting = useMemo(
    () => resources.filter((r) => r.active && (!service || r.kind === service.resource_kind) && (!service?.resource_ids.length || service.resource_ids.includes(r.id))),
    [resources, service],
  );
  useEffect(() => {
    if (resourceId && !fitting.some((r) => r.id === resourceId) && !existing) setResourceId('');
  }, [fitting, resourceId, existing]);

  const slots = useQuery({
    queryKey: ['appointments', 'availability', serviceId, resourceId, start.slice(0, 10)],
    queryFn: () =>
      appointmentsApi.availability({
        service_id: serviceId,
        resource_id: resourceId || undefined,
        from_date: start ? start.slice(0, 10) : dayKey(new Date()),
        days: 7,
        limit: 12,
      }),
    enabled: !!serviceId,
    retry: false,
  });

  const save = useMutation({
    mutationFn: async () => {
      const startAt = `${start}:00`;
      if (existing) {
        return appointmentsApi.updateBooking(existing.id, {
          service_id: serviceId,
          resource_id: resourceId || undefined,
          start_at: startAt,
          client_name: name,
          client_email: email,
          client_phone: phone,
          notes,
          contact_id: contactId || undefined,
        });
      }
      return appointmentsApi.createBooking({
        service_id: serviceId,
        resource_id: resourceId || null,
        start_at: startAt,
        contact_id: contactId || null,
        create_contact: !contactId && saveContact,
        client_name: name,
        client_email: email,
        client_phone: phone,
        notes,
        status,
        repeat_weeks: repeat,
      });
    },
    onSuccess: onSaved,
    onError: (e) => setError(getErrorMessage(e)),
  });
  const locked = existing && ['completed', 'cancelled', 'no_show'].includes(existing.status);
  const endPreview = service && start ? new Date(parseLocal(`${start}:00`).getTime() + service.duration_min * 60_000) : null;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <label className={label} htmlFor="appt-service">{t('appointments.service', { defaultValue: 'Service' })}</label>
        <select id="appt-service" className={input} value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={locked}>
          {activeServices.map((s) => (
            <option key={s.id} value={s.id}>{s.name} · {s.duration_min} {t('appointments.min', { defaultValue: 'min' })}</option>
          ))}
        </select>
        {service && (
          <p className="mt-1 flex flex-wrap gap-x-3 text-2xs text-content-tertiary">
            <span><MoneyDisplay amount={service.price} currency={service.currency} /></span>
            {(service.buffer_before_min > 0 || service.buffer_after_min > 0) && (
              <span>{t('appointments.blocks_total', { defaultValue: 'Blocks {{min}} min incl. buffers', min: blockMinutes(service) })}</span>
            )}
          </p>
        )}
      </div>
      <div>
        <label className={label} htmlFor="appt-resource">{t('appointments.resource', { defaultValue: 'Resource' })}</label>
        <select id="appt-resource" className={input} value={resourceId} onChange={(e) => setResourceId(e.target.value)} disabled={locked}>
          {!existing && <option value="">{t('appointments.any_free', { defaultValue: 'Any free resource' })}</option>}
          {fitting.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="appt-start">{t('appointments.start', { defaultValue: 'Start' })}</label>
        <input id="appt-start" type="datetime-local" step={300} className={input} value={start} onChange={(e) => setStart(e.target.value)} disabled={locked} />
        {endPreview && <p className="mt-1 text-2xs text-content-tertiary">{t('appointments.ends_at', { defaultValue: 'Ends at {{time}}', time: endPreview.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}</p>}
        {!locked && slots.data && slots.data.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-xs text-content-secondary">{t('appointments.next_free', { defaultValue: 'Next free times' })}</p>
            <div className="flex flex-wrap gap-1">
              {slots.data.map((s) => {
                const on = start === s.start_at.slice(0, 16) && resourceId === s.resource_id;
                return (
                  <button
                    key={`${s.start_at}-${s.resource_id}`}
                    type="button"
                    aria-pressed={on}
                    className={clsx('rounded-md border px-1.5 py-0.5 text-2xs', on ? 'border-oe-blue bg-oe-blue text-content-inverse' : 'border-border hover:bg-surface-secondary')}
                    onClick={() => {
                      setStart(s.start_at.slice(0, 16));
                      setResourceId(s.resource_id);
                    }}
                  >
                    {parseLocal(s.start_at).toLocaleString(i18n.language, { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <fieldset className="space-y-2 rounded-lg border border-border-light p-3">
        <legend className="px-1 text-xs font-medium">{clientLabel}</legend>
        <ContactSearchInput
          value={contactId}
          displayValue={contactName || (existing?.contact_id ? existing.client_name : '')}
          onChange={(id, display) => {
            setContactId(id);
            setContactName(display);
            if (display && !name) setName(display);
          }}
          placeholder={t('appointments.search_contact', { defaultValue: 'Find in contacts…' })}
        />
        <input className={input} placeholder={t('appointments.name', { defaultValue: 'Name' })} value={name} onChange={(e) => setName(e.target.value)} aria-label={t('appointments.name', { defaultValue: 'Name' })} />
        <div className="grid grid-cols-2 gap-2">
          <input className={input} type="email" placeholder={t('appointments.email', { defaultValue: 'Email' })} value={email} onChange={(e) => setEmail(e.target.value)} aria-label={t('appointments.email', { defaultValue: 'Email' })} />
          <input className={input} type="tel" placeholder={t('appointments.phone', { defaultValue: 'Phone' })} value={phone} onChange={(e) => setPhone(e.target.value)} aria-label={t('appointments.phone', { defaultValue: 'Phone' })} />
        </div>
        {!existing && !contactId && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={saveContact} onChange={(e) => setSaveContact(e.target.checked)} />
            {t('appointments.save_contact', { defaultValue: 'Save as new contact' })}
          </label>
        )}
      </fieldset>

      <div>
        <label className={label} htmlFor="appt-notes">{t('appointments.notes', { defaultValue: 'Notes' })}</label>
        <textarea id="appt-notes" rows={3} className={`${input} h-auto py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        <p className="mt-1 text-2xs text-amber-700 dark:text-amber-400">
          {t('appointments.notes_hint', { defaultValue: 'Scheduling notes only. Do not enter clinical or other health details.' })}
        </p>
      </div>

      {!existing && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="appt-status">{t('appointments.status', { defaultValue: 'Status' })}</label>
            <select id="appt-status" className={input} value={status} onChange={(e) => setStatus(e.target.value as 'requested' | 'confirmed')}>
              <option value="confirmed">{t('appointments.status_confirmed', { defaultValue: 'Confirmed' })}</option>
              <option value="requested">{t('appointments.status_requested', { defaultValue: 'Requested' })}</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="appt-repeat">{t('appointments.repeat_weeks', { defaultValue: 'Repeat weekly (times)' })}</label>
            <input id="appt-repeat" type="number" min={0} max={52} className={input} value={repeat} onChange={(e) => setRepeat(Math.max(0, Math.min(52, Number(e.target.value) || 0)))} />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-semantic-error" role="alert">{error}</p>}

      <div className="flex justify-between gap-2 pt-2">
        {onDelete ? (
          <Button type="button" variant="danger" size="sm" onClick={onDelete}>{t('common.delete', { defaultValue: 'Delete' })}</Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary" disabled={save.isPending || !serviceId || !start || (!name && !contactId)}>
          {existing ? t('appointments.save_changes', { defaultValue: 'Save changes' }) : t('appointments.book', { defaultValue: 'Book' })}
        </Button>
      </div>
    </form>
  );
}
