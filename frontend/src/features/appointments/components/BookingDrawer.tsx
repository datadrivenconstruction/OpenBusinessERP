import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { useToastStore } from '@/stores/useToastStore';
import { getErrorMessage } from '@/shared/lib/api';
import { appointmentsApi, type Booking, type Resource, type Service } from '../api';
import { BookingForm } from './BookingForm';
import { BookingSummary } from './BookingSummary';

export interface DrawerDraft {
  booking?: Booking;
  resourceId?: string;
  start?: Date;
}

interface Props {
  draft: DrawerDraft;
  services: Service[];
  resources: Resource[];
  onClose: () => void;
}

/** Side drawer: new booking form, or the detail view (status, invoice, reminder) plus edit form. */
export function BookingDrawer({ draft, services, resources, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [current, setCurrent] = useState<Booking | undefined>(draft.booking);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && !confirmDelete && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose, confirmDelete]);

  const done = () => {
    qc.invalidateQueries({ queryKey: ['appointments'] });
    addToast({ type: 'success', title: t('appointments.saved', { defaultValue: 'Saved' }) });
    onClose();
  };
  const remove = async () => {
    if (!current) return;
    setDeleting(true);
    try {
      await appointmentsApi.removeBooking(current.id);
      qc.invalidateQueries({ queryKey: ['appointments'] });
      onClose();
    } catch (e) {
      addToast({ type: 'error', title: getErrorMessage(e) });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-drawer-title"
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-surface-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border-light bg-surface-primary px-5 py-3">
          <div className="min-w-0">
            <h2 id="booking-drawer-title" className="truncate text-lg font-semibold">
              {current ? current.client_name || t('appointments.edit_booking', { defaultValue: 'Booking' }) : t('appointments.new_booking', { defaultValue: 'New booking' })}
            </h2>
            {current?.client_email && <p className="truncate text-xs text-content-tertiary">{current.client_email}{current.client_phone ? ` · ${current.client_phone}` : ''}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })}>
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          {current && (
            <BookingSummary
              booking={current}
              service={services.find((s) => s.id === current.service_id)}
              resource={resources.find((r) => r.id === current.resource_id)}
              onChange={setCurrent}
            />
          )}
          {current && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-tertiary">{t('appointments.details', { defaultValue: 'Details' })}</h3>}
          <BookingForm
            key={current?.status ?? 'new'}
            existing={current}
            resourceId={draft.resourceId}
            start={draft.start}
            services={services}
            resources={resources}
            onSaved={done}
            onDelete={current ? () => setConfirmDelete(true) : undefined}
          />
        </div>
      </aside>
    </div>
      <ConfirmDialog
        open={confirmDelete}
        title={t('appointments.delete_title', { defaultValue: 'Delete booking?' })}
        message={t('appointments.confirm_delete', { defaultValue: 'Delete this booking permanently? Cancelling keeps it in the history instead.' })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
        loading={deleting}
      />
    </>
  );
}
