import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { Button } from '@/shared/ui';
import { useToastStore } from '@/stores/useToastStore';
import { getErrorMessage } from '@/shared/lib/api';
import { itemsApi } from '@/features/items/api';
import { KIND_LABEL, RESOURCE_KINDS, appointmentsApi, type Resource, type ResourceKind, type Service, type ServiceInput } from '../api';
import { serviceErrors, servicePatch } from '../scheduling';
import { ServiceTimeline } from '../components/ServiceTimeline';

const inputCls =
  'h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';
const labelCls = 'block text-xs font-medium text-content-secondary mb-1';
export const SERVICE_COLORS = ['', '#2563eb', '#16a34a', '#d97706', '#dc2626', '#9333ea', '#0891b2', '#db2777', '#4b5563'];
export const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

export const EMPTY_SERVICE: ServiceInput = {
  name: '',
  description: '',
  duration_min: 30,
  buffer_before_min: 0,
  buffer_after_min: 0,
  price: '0',
  currency: 'EUR',
  item_id: null,
  resource_kind: 'staff',
  resource_ids: [],
  color: '',
  online: true,
  active: true,
};

export function serviceBase(s?: Service | ServiceInput): ServiceInput {
  if (!s) return { ...EMPTY_SERVICE };
  const { id: _id, ...rest } = s as Service;
  return { ...EMPTY_SERVICE, ...rest, resource_ids: [...(rest.resource_ids ?? [])] };
}

interface Props {
  existing?: Service;
  /** Prefill for "duplicate". */
  template?: ServiceInput;
  resources: Resource[];
  onClose: () => void;
}

export function ServiceFormModal({ existing, template, resources, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [form, setForm] = useState<ServiceInput>(() => serviceBase(existing ?? template));
  const [touched, setTouched] = useState(false);
  const items = useQuery({
    queryKey: ['items', 'appointment-services'],
    queryFn: () => itemsApi.list({ item_type: 'service', limit: 500 }),
    retry: false,
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const errors = serviceErrors(form);
  const save = useMutation({
    mutationFn: () =>
      existing
        ? appointmentsApi.updateService(existing.id, servicePatch(form, serviceBase(existing)))
        : appointmentsApi.createService({ ...form, name: form.name.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      addToast({ type: 'success', title: t('appointments.service_saved', { defaultValue: 'Service saved' }) });
      onClose();
    },
    onError: (e) => addToast({ type: 'error', title: getErrorMessage(e) }),
  });
  const set = <K extends keyof ServiceInput>(k: K, v: ServiceInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));
  const kindResources = resources.filter((r) => r.kind === form.resource_kind);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="service-form-title" className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-surface-primary shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border-light px-5 py-3">
          <h2 id="service-form-title" className="text-base font-semibold">
            {existing ? t('appointments.edit_service', { defaultValue: 'Edit service' }) : t('appointments.add_service', { defaultValue: 'Add service' })}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })}><X size={18} /></button>
        </div>
        <form
          id="service-form"
          className="grid gap-4 overflow-y-auto px-5 py-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (errors.length === 0) save.mutate();
          }}
        >
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="svc-name">{t('appointments.name', { defaultValue: 'Name' })}</label>
            <input id="svc-name" autoFocus className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={t('appointments.service_name_ph', { defaultValue: 'e.g. Haircut, Consultation, Massage 60' })} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="svc-desc">{t('appointments.description', { defaultValue: 'Description (shown online)' })}</label>
            <textarea id="svc-desc" rows={2} maxLength={2000} className={`${inputCls} h-auto py-2`} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            <span className={labelCls}>{t('appointments.duration', { defaultValue: 'Duration (min)' })}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {DURATION_PRESETS.map((d) => (
                <button key={d} type="button" aria-pressed={form.duration_min === d} onClick={() => set('duration_min', d)} className={clsx('rounded-md border px-2.5 py-1 text-xs', form.duration_min === d ? 'border-oe-blue bg-oe-blue text-content-inverse' : 'border-border hover:bg-surface-secondary')}>
                  {d}
                </button>
              ))}
              <input type="number" min={5} step={5} className={`${inputCls} w-24`} value={form.duration_min} onChange={(e) => set('duration_min', num(e.target.value))} aria-label={t('appointments.duration', { defaultValue: 'Duration (min)' })} />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="svc-bb">{t('appointments.buffer_before', { defaultValue: 'Buffer before (min)' })}</label>
            <input id="svc-bb" type="number" min={0} step={5} className={inputCls} value={form.buffer_before_min} onChange={(e) => set('buffer_before_min', num(e.target.value))} />
          </div>
          <div>
            <label className={labelCls} htmlFor="svc-ba">{t('appointments.buffer_after', { defaultValue: 'Buffer after (min)' })}</label>
            <input id="svc-ba" type="number" min={0} step={5} className={inputCls} value={form.buffer_after_min} onChange={(e) => set('buffer_after_min', num(e.target.value))} />
          </div>
          <div className="sm:col-span-2">
            <ServiceTimeline service={form} />
            <p className="mt-1 text-2xs text-content-tertiary">{t('appointments.buffer_hint', { defaultValue: 'Buffers keep the resource free for preparation or cleaning. Clients only see the service time.' })}</p>
          </div>

          <div>
            <label className={labelCls} htmlFor="svc-price">{t('appointments.price', { defaultValue: 'Price' })}</label>
            <input id="svc-price" type="number" min={0} step="0.01" className={inputCls} value={form.price} onChange={(e) => set('price', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="svc-cur">{t('appointments.currency', { defaultValue: 'Currency' })}</label>
            <input id="svc-cur" maxLength={3} className={`${inputCls} uppercase`} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="svc-item">{t('appointments.catalogue_item', { defaultValue: 'Catalogue item (for invoicing and tax)' })}</label>
            <select id="svc-item" className={inputCls} value={form.item_id ?? ''} onChange={(e) => set('item_id', e.target.value || null)}>
              <option value="">{t('appointments.no_item', { defaultValue: 'None - use service price' })}</option>
              {(items.data?.items ?? []).map((it) => (
                <option key={it.id} value={it.id}>{it.sku} · {it.name}{it.tax_code ? ` (${it.tax_code})` : ''}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls} htmlFor="svc-kind">{t('appointments.resource_type', { defaultValue: 'Needs resource type' })}</label>
            <select id="svc-kind" className={inputCls} value={form.resource_kind} onChange={(e) => setForm({ ...form, resource_kind: e.target.value as ResourceKind, resource_ids: [] })}>
              {RESOURCE_KINDS.map((k) => (
                <option key={k} value={k}>{t(`appointments.kind_${k}`, { defaultValue: KIND_LABEL[k] })}</option>
              ))}
            </select>
          </div>
          <div>
            <span className={labelCls}>{t('appointments.color', { defaultValue: 'Colour in calendar' })}</span>
            <div className="flex flex-wrap gap-1.5">
              {SERVICE_COLORS.map((c) => (
                <button
                  key={c || 'none'}
                  type="button"
                  aria-pressed={form.color === c}
                  aria-label={c || t('appointments.no_color', { defaultValue: 'By status' })}
                  onClick={() => set('color', c)}
                  className={clsx('h-6 w-6 rounded-full border-2', form.color === c ? 'border-content-primary' : 'border-transparent', !c && 'bg-gradient-to-br from-blue-200 to-amber-200')}
                  style={c ? { background: c } : undefined}
                />
              ))}
            </div>
          </div>
          {kindResources.length > 0 && (
            <fieldset className="sm:col-span-2">
              <legend className={labelCls}>{t('appointments.who_provides', { defaultValue: 'Who can provide it (none ticked = all)' })}</legend>
              <div className="flex flex-wrap gap-2">
                {kindResources.map((r) => {
                  const on = form.resource_ids.includes(r.id);
                  return (
                    <label key={r.id} className={clsx('flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs', on ? 'border-oe-blue bg-oe-blue/10' : 'border-border')}>
                      <input type="checkbox" checked={on} onChange={() => set('resource_ids', on ? form.resource_ids.filter((x) => x !== r.id) : [...form.resource_ids, r.id])} />
                      {r.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.online} onChange={(e) => set('online', e.target.checked)} />
            {t('appointments.bookable_online', { defaultValue: 'Bookable online' })}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
            {t('appointments.active', { defaultValue: 'Active' })}
          </label>
          {touched && errors.length > 0 && (
            <ul className="text-sm text-semantic-error sm:col-span-2" role="alert">
              {errors.map(([k, d]) => <li key={k}>{t(k, { defaultValue: d })}</li>)}
            </ul>
          )}
        </form>
        <div className="flex justify-end gap-2 border-t border-border-light px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button variant="primary" size="sm" type="submit" form="service-form" disabled={save.isPending}>{t('common.save', { defaultValue: 'Save' })}</Button>
        </div>
      </div>
    </div>
  );
}
