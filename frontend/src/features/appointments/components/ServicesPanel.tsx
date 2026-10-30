import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Archive, ArchiveRestore, Clock, Copy, Globe, Pencil, Plus, Search, Settings2, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState } from '@/shared/ui';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { useToastStore } from '@/stores/useToastStore';
import { getErrorMessage } from '@/shared/lib/api';
import { KIND_LABEL, appointmentsApi, type Resource, type Service, type ServiceInput } from '../api';
import { ServiceFormModal, serviceBase } from '../modals/ServiceFormModal';
import { ServiceTimeline } from './ServiceTimeline';
import { inputCls } from './CalendarToolbar';
import { fmtList } from '@/shared/lib/formatters';

type Edit = { existing?: Service; template?: ServiceInput } | null;

/** Service catalogue: duration, buffers, price, who provides it, online visibility. */
export function ServicesPanel({ services, resources }: { services: Service[]; resources: Resource[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [edit, setEdit] = useState<Edit>(null);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [toDelete, setToDelete] = useState<Service | null>(null);
  const fail = (e: unknown) => addToast({ type: 'error', title: getErrorMessage(e) });

  const toggle = useMutation({
    mutationFn: (s: Service) => appointmentsApi.updateService(s.id, { active: !s.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => appointmentsApi.removeService(id),
    onSuccess: () => {
      setToDelete(null);
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (e) => {
      setToDelete(null);
      fail(e);
    },
  });

  const resName = useMemo(() => new Map(resources.map((r) => [r.id, r.name])), [resources]);
  const rows = services.filter(
    (s) => (showInactive || s.active) && (!query.trim() || s.name.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const inactiveCount = services.filter((s) => !s.active).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary" />
          <input className={clsx(inputCls, 'pl-8')} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('appointments.search_services', { defaultValue: 'Search services' })} aria-label={t('appointments.search_services', { defaultValue: 'Search services' })} />
        </div>
        {inactiveCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-content-secondary">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            {t('appointments.show_archived', { defaultValue: 'Show archived ({{count}})', count: inactiveCount })}
          </label>
        )}
        <Button className="ml-auto" size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEdit({})}>
          {t('appointments.add_service', { defaultValue: 'Add service' })}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Settings2 size={22} />}
          title={t('appointments.no_services', { defaultValue: 'No services yet' })}
          description={t('appointments.no_services_body', { defaultValue: 'A service sets how long a booking takes, the buffers around it and its price.' })}
          action={{ label: t('appointments.add_service', { defaultValue: 'Add service' }), onClick: () => setEdit({}) }}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <li key={s.id} className={clsx('group flex flex-col rounded-xl border border-border-light bg-surface-elevated p-4', !s.active && 'opacity-60')}>
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color || 'rgb(59 130 246)' }} />
                <div className="min-w-0 flex-1">
                  <button type="button" className="block truncate text-left font-semibold hover:underline" onClick={() => setEdit({ existing: s })}>
                    {s.name}
                  </button>
                  {s.description && <p className="line-clamp-2 text-xs text-content-secondary">{s.description}</p>}
                </div>
                <span className="shrink-0 text-sm font-semibold"><MoneyDisplay amount={s.price} currency={s.currency} /></span>
              </div>
              <div className="mt-3">
                <ServiceTimeline service={s} compact />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-content-secondary">
                <span className="flex items-center gap-1"><Clock size={12} />{s.duration_min} {t('appointments.min', { defaultValue: 'min' })}</span>
                {(s.buffer_before_min > 0 || s.buffer_after_min > 0) && (
                  <span>{t('appointments.buffers_short', { defaultValue: 'buffers {{before}}/{{after}}', before: s.buffer_before_min, after: s.buffer_after_min })}</span>
                )}
                <span>
                  {s.resource_ids.length
                    ? fmtList(s.resource_ids.map((id) => resName.get(id)).filter((n): n is string => !!n))
                    : t(`appointments.kind_${s.resource_kind}`, { defaultValue: KIND_LABEL[s.resource_kind] })}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-1 border-t border-border-light pt-2">
                {s.online && s.active && <Badge variant="blue" size="sm"><Globe size={10} className="mr-1 inline" />{t('appointments.source_online', { defaultValue: 'Online' })}</Badge>}
                {!s.active && <Badge variant="neutral" size="sm">{t('appointments.inactive', { defaultValue: 'Inactive' })}</Badge>}
                {s.item_id && <Badge variant="neutral" size="sm">{t('appointments.linked_item', { defaultValue: 'Catalogue item' })}</Badge>}
                <div className="ml-auto flex gap-0.5">
                  <IconBtn label={t('common.edit', { defaultValue: 'Edit' })} onClick={() => setEdit({ existing: s })}><Pencil size={14} /></IconBtn>
                  <IconBtn label={t('appointments.duplicate', { defaultValue: 'Duplicate' })} onClick={() => setEdit({ template: { ...serviceBase(s), name: `${s.name} (2)` } })}><Copy size={14} /></IconBtn>
                  <IconBtn label={s.active ? t('appointments.archive', { defaultValue: 'Archive' }) : t('appointments.restore', { defaultValue: 'Restore' })} onClick={() => toggle.mutate(s)}>
                    {s.active ? <Archive size={14} /> : <ArchiveRestore size={14} />}
                  </IconBtn>
                  <IconBtn label={t('common.delete', { defaultValue: 'Delete' })} onClick={() => setToDelete(s)}><Trash2 size={14} /></IconBtn>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {edit && <ServiceFormModal existing={edit.existing} template={edit.template} resources={resources} onClose={() => setEdit(null)} />}
      <ConfirmDialog
        open={!!toDelete}
        title={t('appointments.delete_service_title', { defaultValue: 'Delete service?' })}
        message={t('appointments.delete_service_body', { defaultValue: 'A service that already has bookings cannot be deleted; archive it instead.' })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        onCancel={() => setToDelete(null)}
        loading={remove.isPending}
      />
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="rounded-md p-1.5 text-content-tertiary hover:bg-surface-secondary hover:text-content-primary">
      {children}
    </button>
  );
}
