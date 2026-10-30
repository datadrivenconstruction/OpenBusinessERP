import { useTranslation } from 'react-i18next';
import type { Service } from '../api';
import { blockMinutes } from '../scheduling';

type Timing = Pick<Service, 'duration_min' | 'buffer_before_min' | 'buffer_after_min' | 'color'>;

/** Proportional bar: buffer before | service | buffer after. */
export function ServiceTimeline({ service, compact = false }: { service: Timing; compact?: boolean }) {
  const { t } = useTranslation();
  const total = Math.max(blockMinutes(service), 1);
  const pct = (m: number) => `${(m / total) * 100}%`;
  const color = service.color || 'rgb(59 130 246)';
  return (
    <div>
      <div className={compact ? 'flex h-1.5 overflow-hidden rounded-full bg-surface-tertiary' : 'flex h-3 overflow-hidden rounded-full bg-surface-tertiary'} aria-hidden="true">
        {service.buffer_before_min > 0 && <div className="bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(0,0,0,0.12)_3px,rgba(0,0,0,0.12)_6px)]" style={{ width: pct(service.buffer_before_min) }} />}
        <div style={{ width: pct(service.duration_min), background: color }} />
        {service.buffer_after_min > 0 && <div className="bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(0,0,0,0.12)_3px,rgba(0,0,0,0.12)_6px)]" style={{ width: pct(service.buffer_after_min) }} />}
      </div>
      {!compact && (
        <p className="mt-1 flex justify-between text-2xs tabular-nums text-content-tertiary">
          <span>{service.buffer_before_min > 0 ? t('appointments.tl_before', { defaultValue: '{{min}} min prep', min: service.buffer_before_min }) : ''}</span>
          <span className="font-medium text-content-secondary">{t('appointments.tl_service', { defaultValue: '{{min}} min service', min: service.duration_min })}</span>
          <span>{service.buffer_after_min > 0 ? t('appointments.tl_after', { defaultValue: '{{min}} min after', min: service.buffer_after_min }) : ''}</span>
        </p>
      )}
    </div>
  );
}
