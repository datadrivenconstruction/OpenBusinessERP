import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { BellRing, Plus, Scale } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { Breadcrumb, DismissibleInfo, ModuleGuideButton } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { getErrorMessage } from '@/shared/lib/api';
import { useTabKeyboardNav } from '@/shared/hooks/useTabKeyboardNav';
import { InsightsPanel, InsightsToggleButton, useModuleInsights } from '@/features/insights';
import { BUCKETS, receivablesApi, type BucketFilter } from './api';
import { AgingTab } from './components/AgingTab';
import { CustomerDrawer } from './components/CustomerDrawer';
import { DunningTab } from './components/DunningTab';
import { ReceivablesKpis } from './components/ReceivablesKpis';
import { receivablesGuide } from './receivablesGuide';
import { buildReceivablesInsights } from './receivablesInsights';

type Tab = 'aging' | 'dunning';
const TABS: Tab[] = ['aging', 'dunning'];
const TAB_ICON: Record<Tab, React.ElementType> = { aging: Scale, dunning: BellRing };

export function ReceivablesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'aging') as Tab;
  const [asOf, setAsOf] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bucketParam = params.get('bucket') as BucketFilter | null;
  const bucket = bucketParam && [...BUCKETS, 'overdue'].includes(bucketParam) ? bucketParam : null;
  const customer = params.get('customer');
  const patch = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p);
  };
  const setBucket = (b: BucketFilter | null) => patch({ tab: 'aging', bucket: b });
  const openCustomer = (key: string | null) => patch({ customer: key });
  const promises = useQuery({ queryKey: ['receivables', 'promises'], queryFn: () => receivablesApi.promises('open') });
  const aging = useQuery({ queryKey: ['receivables', 'aging', asOf], queryFn: () => receivablesApi.aging(asOf || undefined) });
  const create = useMutation({
    mutationFn: () => receivablesApi.createRun(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['receivables'] }),
    onError: (e) => setError(getErrorMessage(e)),
  });
  const onTabKeyDown = useTabKeyboardNav<Tab>({
    ids: TABS,
    activeId: tab,
    onChange: (k) => patch({ tab: k }),
    orientation: 'horizontal',
  });
  const cur = aging.data?.base_currency ?? aging.data?.rows[0]?.invoices[0]?.currency ?? 'EUR';
  const insights = useModuleInsights('receivables', { defaultOpen: false });
  const { datasets: insightDatasets, builtins: insightBuiltins } = useMemo(
    () => buildReceivablesInsights(aging.data, cur, t),
    [aging.data, cur, t],
  );
  const proposeRun = () => {
    if (tab !== 'dunning') patch({ tab: 'dunning' });
    create.mutate();
  };

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: t('receivables.title', { defaultValue: 'Receivables' }) }]} />

      <PageHeader
        srTitle={t('receivables.title', { defaultValue: 'Receivables' })}
        subtitle={t('receivables.subtitle', {
          defaultValue: 'See who owes you money, how overdue it is, and follow up with reviewed reminders.',
        })}
        actions={
          <>
            <InsightsToggleButton open={insights.open} onClick={insights.toggle} />
            <ModuleGuideButton content={receivablesGuide} onCta={proposeRun} />
            <Button variant="primary" size="sm" icon={<Plus size={14} />} disabled={create.isPending} onClick={proposeRun}>
              {t('receivables.new_run', { defaultValue: 'Propose dunning run' })}
            </Button>
          </>
        }
      />

      <InsightsPanel
        open={insights.open}
        title={t('receivables.insights.title', { defaultValue: 'Receivables insights' })}
        datasets={insightDatasets}
        builtins={insightBuiltins}
        custom={insights.custom}
        onAdd={insights.addCustom}
        onUpdate={insights.updateCustom}
        onRemove={insights.removeCustom}
        onCollapse={() => insights.setOpen(false)}
      />

      <ReceivablesKpis
        aging={aging.data}
        promises={promises.data ?? []}
        currency={cur}
        onOverdue={() => setBucket('overdue')}
        onSevere={() => setBucket('d90_plus')}
        onPromises={() => {
          patch({ tab: 'dunning' });
          setTimeout(() => document.getElementById('receivables-promises')?.scrollIntoView({ behavior: 'smooth' }), 50);
        }}
      />

      <DismissibleInfo
        storageKey="receivables"
        title={t('receivables.intro_title', { defaultValue: 'Know who owes you, and chase it on time' })}
        links={[
          { label: t('receivables.intro_link_sales', { defaultValue: 'Sales' }), onClick: () => navigate('/sales?tab=invoices') },
          { label: t('receivables.intro_link_banking', { defaultValue: 'Banking' }), onClick: () => navigate('/banking') },
          { label: t('receivables.intro_link_accounting', { defaultValue: 'Accounting' }), onClick: () => navigate('/accounting') },
        ]}
      >
        {t('receivables.intro_body', {
          defaultValue:
            'Open invoices from Sales are grouped by how far past due they are. Propose a dunning run to draft reminder letters, review each one, and send it yourself. Nothing is sent automatically.',
        })}
      </DismissibleInfo>

      <div className="border-b border-border-light">
        <nav
          className="flex gap-1 -mb-px"
          role="tablist"
          aria-label={t('receivables.tabs_aria', { defaultValue: 'Receivables sections' })}
          onKeyDown={onTabKeyDown}
        >
          {TABS.map((k) => {
            const Icon = TAB_ICON[k];
            const active = k === tab;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                id={`receivables-tab-${k}`}
                aria-selected={active}
                aria-controls={`receivables-panel-${k}`}
                tabIndex={active ? 0 : -1}
                onClick={() => patch({ tab: k })}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  active
                    ? 'border-oe-blue text-oe-blue'
                    : 'border-transparent text-content-secondary hover:text-content-primary',
                )}
              >
                <Icon size={14} />
                {t(`receivables.tab_${k}`, { defaultValue: k === 'aging' ? 'Aging' : 'Dunning' })}
              </button>
            );
          })}
        </nav>
      </div>

      {tab === 'aging' ? (
        <AgingTab
          aging={aging}
          asOf={asOf}
          setAsOf={setAsOf}
          cur={cur}
          bucket={bucket}
          setBucket={setBucket}
          onOpenCustomer={openCustomer}
        />
      ) : (
        <DunningTab
          error={error}
          setError={setError}
          creating={create.isPending}
          currency={cur}
          onOpenCustomer={openCustomer}
        />
      )}

      {customer && <CustomerDrawer partnerKey={customer} asOf={asOf || undefined} onClose={() => openCustomer(null)} />}
    </div>
  );
}
