/**
 * Job-role presets (Owner, Accountant, Sales, Purchasing & Warehouse, Read-only)
 * with a member assignment table and the preset x permission matrix.
 *
 * API: GET /v1/business-roles/, PUT /v1/business-roles/users/{id}/
 */
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Minus, KeyRound } from 'lucide-react';
import { Card, CardHeader, CardContent, Skeleton } from '@/shared/ui';
import { apiGet, apiPut } from '@/shared/lib/api';

interface Preset {
  key: string;
  role: string;
  permissions: string[];
}
interface Member {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  preset: string | null;
}
interface BusinessRoles {
  modules: string[];
  permissions: string[];
  presets: Preset[];
  members: Member[];
}

const PRESET_DEFAULTS: Record<string, string> = {
  owner: 'Owner / Admin',
  accountant: 'Accountant',
  sales: 'Sales',
  purchasing: 'Purchasing & Warehouse',
  readonly: 'Read-only',
};

export function SettingsRolePresets({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['business-roles'],
    queryFn: () => apiGet<BusinessRoles>('/v1/business-roles/'),
    retry: false,
  });
  const assign = useMutation({
    mutationFn: ({ id, preset }: { id: string; preset: string }) =>
      apiPut<Member, { preset: string }>(`/v1/business-roles/users/${id}/`, { preset }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['business-roles'] }),
  });

  const label = (key: string) => t(`settings.role_preset_${key}`, { defaultValue: PRESET_DEFAULTS[key] ?? key });

  if (query.isError) return null;
  const data = query.data;

  return (
    <Card>
      <CardHeader
        title={t('settings.role_presets_title', { defaultValue: 'Job roles' })}
        subtitle={t('settings.role_presets_subtitle', {
          defaultValue: 'Assign a ready-made role to each member. The matrix shows what each role can do.',
        })}
        action={<KeyRound size={20} className="text-oe-blue" aria-hidden="true" />}
      />
      <CardContent>
        {!data ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-6">
            <table className="w-full text-sm">
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.id} className="border-b border-border-light last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-content-primary">{m.full_name || m.email}</div>
                      <div className="text-xs text-content-tertiary">{m.email}</div>
                    </td>
                    <td className="py-2 text-right">
                      <select
                        aria-label={t('settings.role_preset_for', { defaultValue: 'Job role for {{name}}', name: m.email })}
                        className="h-8 rounded-lg border border-border bg-surface-primary px-2 text-sm disabled:opacity-60"
                        value={m.preset ?? ''}
                        disabled={!canEdit || assign.isPending}
                        onChange={(e) => e.target.value && assign.mutate({ id: m.id, preset: e.target.value })}
                      >
                        <option value="">
                          {t('settings.role_preset_custom', { defaultValue: 'Custom ({{role}})', role: m.role })}
                        </option>
                        {data.presets.map((p) => (
                          <option key={p.key} value={p.key}>
                            {label(p.key)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {assign.isError && (
              <p className="text-xs text-semantic-error">{(assign.error as Error).message}</p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs" aria-label={t('settings.role_matrix', { defaultValue: 'Permission matrix' })}>
                <thead>
                  <tr className="text-left text-content-secondary">
                    <th className="py-1.5 pr-3 font-medium">
                      {t('settings.role_matrix_permission', { defaultValue: 'Permission' })}
                    </th>
                    {data.presets.map((p) => (
                      <th key={p.key} className="px-2 py-1.5 text-center font-medium">
                        {label(p.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.permissions.map((perm) => (
                    <tr key={perm} className="border-t border-border-light">
                      <td className="py-1 pr-3 font-mono text-content-secondary">{perm}</td>
                      {data.presets.map((p) => (
                        <td key={p.key} className="px-2 py-1 text-center">
                          {p.permissions.includes(perm) ? (
                            <Check size={14} className="inline text-semantic-success" aria-label={t('settings.role_matrix_yes', { defaultValue: 'Allowed' })} />
                          ) : (
                            <Minus size={14} className="inline text-content-tertiary" aria-label={t('settings.role_matrix_no', { defaultValue: 'Not allowed' })} />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
