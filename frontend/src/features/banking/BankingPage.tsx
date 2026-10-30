import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeftRight, Landmark, ListFilter, Plus, Upload } from 'lucide-react';
import { Breadcrumb, Button, DismissibleInfo, EmptyState, ModuleGuideButton, Card } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { useTabKeyboardNav } from '@/shared/hooks/useTabKeyboardNav';
import { bankingGuide } from './bankingGuide';
import { bankingApi, type BankAccount, type BankRule, type BankRuleInput } from './api';
import { AccountCards } from './components/AccountCards';
import { BankingKpis, mainCurrency } from './components/BankingKpis';
import { ImportWizard } from './components/ImportWizard';
import { ReconcileWorkspace } from './components/ReconcileWorkspace';
import { RulesPanel } from './components/RulesPanel';
import { AccountFormModal } from './modals/AccountFormModal';
import { BulkAcceptModal } from './modals/BulkAcceptModal';
import { MatchSettingsModal } from './modals/MatchSettingsModal';
import { RuleFormModal } from './modals/RuleFormModal';

type Tab = 'reconcile' | 'accounts' | 'rules' | 'import';
const TABS: Tab[] = ['reconcile', 'accounts', 'rules', 'import'];
const TAB_ICON: Record<Tab, React.ElementType> = { reconcile: ArrowLeftRight, accounts: Landmark, rules: ListFilter, import: Upload };
const TAB_LABEL: Record<Tab, string> = { reconcile: 'Reconciliation', accounts: 'Accounts', rules: 'Rules', import: 'Import' };

type ModalState =
  | { kind: 'account'; existing?: BankAccount }
  | { kind: 'rule'; existing?: BankRule; initial?: BankRuleInput }
  | { kind: 'bulk' }
  | { kind: 'settings' }
  | null;

export function BankingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'reconcile') as Tab;
  const accountId = params.get('account') ?? '';
  const [modal, setModal] = useState<ModalState>(null);
  const go = (next: Tab, account?: string) => setParams(account ? { tab: next, account } : { tab: next });
  const onTabKeyDown = useTabKeyboardNav<Tab>({ ids: TABS, activeId: tab, onChange: (k) => go(k), orientation: 'horizontal' });

  const accounts = useQuery({ queryKey: ['banking', 'accounts'], queryFn: bankingApi.accounts });
  const summary = useQuery({ queryKey: ['banking', 'summary'], queryFn: bankingApi.summary });
  const settings = useQuery({ queryKey: ['banking', 'settings'], queryFn: bankingApi.settings });
  const accs = accounts.data ?? [];
  const noAccounts = !accounts.isLoading && accs.length === 0;
  const addAccount = () => setModal({ kind: 'account' });

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: t('banking.title', { defaultValue: 'Banking' }) }]} />
      <PageHeader
        srTitle={t('banking.title', { defaultValue: 'Banking' })}
        subtitle={t('banking.subtitle', { defaultValue: 'Match bank statement lines to invoices and bills and keep your books in step with the bank.' })}
        actions={
          <>
            <ModuleGuideButton content={bankingGuide} onCta={() => go('import')} />
            <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addAccount}>
              {t('banking.add_account', { defaultValue: 'Add account' })}
            </Button>
            <Button variant="primary" size="sm" icon={<Upload size={14} />} disabled={noAccounts} onClick={() => go('import')}>
              {t('banking.new_import', { defaultValue: 'Import statement' })}
            </Button>
          </>
        }
      />
      <DismissibleInfo
        storageKey="banking"
        title={t('banking.intro_title', { defaultValue: 'Reconcile your bank in minutes' })}
        links={[
          { label: t('banking.intro_link_accounting', { defaultValue: 'Accounting' }), onClick: () => navigate('/accounting') },
          { label: t('banking.intro_link_sales', { defaultValue: 'Sales' }), onClick: () => navigate('/sales') },
          { label: t('banking.intro_link_purchasing', { defaultValue: 'Purchasing' }), onClick: () => navigate('/purchasing') },
        ]}
      >
        {t('banking.intro_body', {
          defaultValue:
            'Import a statement from your online banking, then confirm the suggested matches against your open invoices and bills. Lines without a counterpart can be booked to an account or ignored, and every match can be undone.',
        })}
      </DismissibleInfo>

      <BankingKpis summary={summary.data} loading={summary.isLoading} onOpenLines={() => go('reconcile')} onRules={() => go('rules')} />

      <div className="border-b border-border-light">
        <nav className="-mb-px flex gap-1 overflow-x-auto" role="tablist" aria-label={t('banking.tabs_aria', { defaultValue: 'Banking sections' })} onKeyDown={onTabKeyDown}>
          {TABS.map((k) => {
            const Icon = TAB_ICON[k];
            const active = k === tab;
            const badge = k === 'reconcile' ? summary.data?.unmatched_count : undefined;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                id={`banking-tab-${k}`}
                aria-selected={active}
                aria-controls={`banking-panel-${k}`}
                tabIndex={active ? 0 : -1}
                onClick={() => go(k)}
                className={clsx(
                  'flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  active ? 'border-oe-blue text-oe-blue' : 'border-transparent text-content-secondary hover:text-content-primary',
                )}
              >
                <Icon size={14} />
                {t(`banking.tab_${k}`, { defaultValue: TAB_LABEL[k] })}
                {!!badge && <span className="rounded-full bg-amber-500/15 px-1.5 text-[11px] tabular-nums text-amber-700 dark:text-amber-300">{badge}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      <div role="tabpanel" id={`banking-panel-${tab}`} aria-labelledby={`banking-tab-${tab}`}>
        {noAccounts && tab !== 'accounts' && tab !== 'rules' ? (
          <Card padding="none">
            <EmptyState
              icon={<Landmark size={22} />}
              title={t('banking.no_accounts', { defaultValue: 'No bank accounts yet' })}
              description={t('banking.no_accounts_desc', { defaultValue: 'Add your first account, then import a statement exported from online banking.' })}
              action={{ label: t('banking.add_account', { defaultValue: 'Add account' }), onClick: addAccount }}
            />
          </Card>
        ) : (
          <>
            {tab === 'reconcile' && (
              <ReconcileWorkspace
                accounts={accs}
                accountId={accountId}
                onAccount={(id) => go('reconcile', id)}
                onImport={() => go('import', accountId)}
                onBulk={() => setModal({ kind: 'bulk' })}
                onSettings={() => setModal({ kind: 'settings' })}
                onNewRule={(initial) => setModal({ kind: 'rule', initial })}
                writeOffMax={Number(settings.data?.writeoff_max ?? 0)}
              />
            )}
            {tab === 'accounts' && (
              <div className="space-y-4">
                <AccountCards
                  accounts={accs}
                  summary={summary.data?.accounts ?? []}
                  onAdd={addAccount}
                  onEdit={(a) => setModal({ kind: 'account', existing: a })}
                  onImport={(id) => go('import', id)}
                  onReconcile={(id) => go('reconcile', id)}
                />
                <p className="text-xs text-content-tertiary">
                  {t('banking.feeds_note', { defaultValue: 'Live bank feeds are not connected. Import statement files exported from your online banking (camt.053, MT940 or CSV).' })}
                </p>
              </div>
            )}
            {tab === 'rules' && (
              <RulesPanel
                currency={mainCurrency(summary.data)}
                onNew={() => setModal({ kind: 'rule' })}
                onEdit={(r) => setModal({ kind: 'rule', existing: r })}
              />
            )}
            {tab === 'import' && <ImportWizard accounts={accs} initialAccountId={accountId || undefined} onReconcile={(id) => go('reconcile', id)} />}
          </>
        )}
      </div>

      {modal?.kind === 'account' && <AccountFormModal existing={modal.existing} onClose={() => setModal(null)} />}
      {modal?.kind === 'rule' && <RuleFormModal existing={modal.existing} initial={modal.initial} onClose={() => setModal(null)} />}
      {modal?.kind === 'bulk' && <BulkAcceptModal accountId={accountId || undefined} onClose={() => setModal(null)} />}
      {modal?.kind === 'settings' && <MatchSettingsModal settings={settings.data} onClose={() => setModal(null)} />}
    </div>
  );
}
