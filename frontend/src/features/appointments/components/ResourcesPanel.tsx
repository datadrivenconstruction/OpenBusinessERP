import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Plus, Trash2, Users } from 'lucide-react';
import { Badge, Button, EmptyState } from '@/shared/ui';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { useToastStore } from '@/stores/useToastStore';
import { getErrorMessage } from '@/shared/lib/api';
import { KIND_LABEL, RESOURCE_KINDS, appointmentsApi, type Resource, type ResourceKind } from '../api';
import { SERVICE_COLORS } from '../modals/ServiceFormModal';
import { AvailabilityEditor, DEFAULT_HOURS } from './AvailabilityEditor';
import { inputCls } from './CalendarToolbar';

/** Staff, rooms, chairs and equipment, each with its own availability rules. */
export function ResourcesPanel({ resources }: { resources: Resource[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ResourceKind>('staff');
  const [open, setOpen] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Resource | null>(null);
  const fail = (e: unknown) => addToast({ type: 'error', title: getErrorMessage(e) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['appointments'] });

  const create = useMutation({
    mutationFn: () => appointmentsApi.createResource({ name: name.trim(), kind, color: '', active: true, sort_order: resources.length, hours: DEFAULT_HOURS }),
    onSuccess: (r) => {
      setName('');
      setOpen(r.id);
      invalidate();
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Resource> }) => appointmentsApi.updateResource(id, patch),
    onSuccess: invalidate,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => appointmentsApi.removeResource(id),
    onSuccess: invalidate,
    onError: fail,
    onSettled: () => setToDelete(null),
  });

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <input className={clsx(inputCls, 'max-w-xs')} placeholder={t('appointments.resource_name', { defaultValue: 'Name, e.g. Anna or Room 2' })} value={name} onChange={(e) => setName(e.target.value)} aria-label={t('appointments.resource_name', { defaultValue: 'Name, e.g. Anna or Room 2' })} />
        <select className={clsx(inputCls, 'w-auto')} value={kind} onChange={(e) => setKind(e.target.value as ResourceKind)} aria-label={t('appointments.resource_type', { defaultValue: 'Needs resource type' })}>
          {RESOURCE_KINDS.map((k) => (
            <option key={k} value={k}>{t(`appointments.kind_${k}`, { defaultValue: KIND_LABEL[k] })}</option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="primary" icon={<Plus size={14} />} disabled={!name.trim() || create.isPending}>
          {t('appointments.add_resource', { defaultValue: 'Add resource' })}
        </Button>
      </form>
      <p className="text-xs text-content-tertiary">{t('appointments.resources_hint', { defaultValue: 'New resources start with Mon–Fri 9:00–17:00. Open one to set its hours, breaks and days off.' })}</p>

      {resources.length === 0 ? (
        <EmptyState icon={<Users size={22} />} title={t('appointments.no_resources_title', { defaultValue: 'No resources yet' })} description={t('appointments.no_resources', { defaultValue: 'Add a staff member, room or chair under Resources to start booking.' })} />
      ) : (
        <ul className="space-y-2">
          {resources.map((r) => {
            const expanded = open === r.id;
            return (
              <li key={r.id} className={clsx('rounded-xl border border-border-light bg-surface-elevated', !r.active && 'opacity-70')}>
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded}>
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="h-3 w-3 shrink-0 rounded-full border border-border" style={{ background: r.color || 'transparent' }} />
                    <span className="truncate font-medium">{r.name}</span>
                    <Badge variant="neutral" size="sm">{t(`appointments.kind_${r.kind}`, { defaultValue: KIND_LABEL[r.kind] })}</Badge>
                    {!r.active && <Badge variant="warning" size="sm">{t('appointments.inactive', { defaultValue: 'Inactive' })}</Badge>}
                  </button>
                  <div className="flex items-center gap-3 text-xs">
                    <div className="hidden gap-1 sm:flex">
                      {SERVICE_COLORS.slice(1, 7).map((c) => (
                        <button key={c} type="button" aria-label={c} aria-pressed={r.color === c} onClick={() => update.mutate({ id: r.id, patch: { color: r.color === c ? '' : c } })} className={clsx('h-4 w-4 rounded-full border-2', r.color === c ? 'border-content-primary' : 'border-transparent')} style={{ background: c }} />
                      ))}
                    </div>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={r.active} onChange={(e) => update.mutate({ id: r.id, patch: { active: e.target.checked } })} />
                      {t('appointments.active', { defaultValue: 'Active' })}
                    </label>
                    <button type="button" className="rounded p-1 text-content-tertiary hover:text-semantic-error" aria-label={t('common.delete', { defaultValue: 'Delete' })} onClick={() => setToDelete(r)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-border-light p-3">
                    <AvailabilityEditor resource={r} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={!!toDelete}
        title={t('appointments.delete_resource_title', { defaultValue: 'Delete resource?' })}
        message={t('appointments.delete_resource_body', { defaultValue: 'A resource with bookings cannot be deleted; switch it to inactive instead.' })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        onCancel={() => setToDelete(null)}
        loading={remove.isPending}
      />
    </div>
  );
}
