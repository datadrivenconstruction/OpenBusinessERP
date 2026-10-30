import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, CardContent, CardHeader, CountryFlag } from '@/shared/ui';
import { useToastStore } from '@/stores/useToastStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { normalizeRole } from '@/shared/lib/roles';
import { useBusinessDemoCases, useInstallBusinessDemo } from './api';

/** Settings section for business companies: sample companies that fill the workspace with realistic records. */
export function SampleDataPanel() {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const isAdmin = normalizeRole(useAuthStore((s) => s.userRole)) === 'admin';
  const cases = useBusinessDemoCases();
  const install = useInstallBusinessDemo();

  const run = (key: string, company: string) =>
    install.mutate(key, {
      onSuccess: () =>
        addToast({
          type: 'success',
          title: t('bizdemo.installed_toast', { defaultValue: 'Sample data loaded' }),
          message: company,
        }),
      onError: (err: Error) =>
        addToast({
          type: 'error',
          title: t('bizdemo.install_failed', { defaultValue: 'Could not load sample data' }),
          message: err.message,
        }),
    });

  const rows = cases.data ?? [];
  return (
    <Card className="lg:col-span-2" data-testid="sample-data-panel">
      <CardHeader
        title={t('bizdemo.title', { defaultValue: 'Sample data' })}
        subtitle={t('bizdemo.subtitle', {
          defaultValue: 'Load a ready-made company with customers, invoices, stock and a ledger to try the product with.',
        })}
      />
      <CardContent>
        {cases.isLoading ? (
          <div className="h-16 rounded-lg bg-surface-secondary" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-content-tertiary">
            {t('bizdemo.none', { defaultValue: 'No sample companies are available on this server.' })}
          </p>
        ) : (
          <ul className="divide-y divide-border-light rounded-xl border border-border-light">
            {rows.map((c) => (
              <li key={c.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <CountryFlag code={c.country} size={18} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-content-primary">{c.company}</p>
                  <p className="mt-0.5 text-xs text-content-secondary">
                    {t(`bizonb.ind_${c.industry}`, { defaultValue: c.industry.replace(/_/g, ' ') })}
                    {c.summary ? ` · ${c.summary}` : ''}
                  </p>
                </div>
                {c.installed ? (
                  <Badge variant="success">{t('bizdemo.installed', { defaultValue: 'Installed' })}</Badge>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!isAdmin || install.isPending}
                    loading={install.isPending && install.variables === c.key}
                    title={isAdmin ? undefined : t('bizdemo.admin_only', { defaultValue: 'Only an administrator can load sample data' })}
                    onClick={() => run(c.key, c.company)}
                  >
                    {t('bizdemo.install', { defaultValue: 'Install' })}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
