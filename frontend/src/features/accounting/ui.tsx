import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { BarChart3, BookOpen, LayoutDashboard, ListTree } from 'lucide-react';
import { Breadcrumb, Button, DismissibleInfo, ModuleGuideButton } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { useTabKeyboardNav } from '@/shared/hooks/useTabKeyboardNav';
import { getErrorMessage } from '@/shared/lib/api';
import { accountingGuide } from './accountingGuide';

export const inputCls =
  'h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue disabled:bg-surface-secondary';
export const thCls = 'px-4 py-2.5 font-medium';
export const numCls = 'px-4 py-2 text-right tabular-nums';

type TabId = 'overview' | 'accounts' | 'journal' | 'reports';
const TAB_IDS: readonly TabId[] = ['overview', 'accounts', 'journal', 'reports'];
const TAB_PATH: Record<TabId, string> = {
  overview: '/accounting',
  accounts: '/accounting/accounts',
  journal: '/accounting/journal',
  reports: '/accounting/reports',
};

function tabFor(pathname: string): TabId {
  if (pathname.startsWith('/accounting/journal')) return 'journal';
  if (pathname.startsWith('/accounting/reports')) return 'reports';
  if (pathname.startsWith('/accounting/accounts') || pathname.startsWith('/accounting/ledger')) return 'accounts';
  return 'overview';
}

/** Page frame shared by all accounting screens: breadcrumb, header, guide, intro and section tabs. */
export function AccountingShell({
  title,
  actions,
  parent,
  children,
}: {
  title: string;
  actions?: ReactNode;
  /** Intermediate breadcrumb step for sub-pages (entry, ledger). */
  parent?: { label: string; to: string };
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active = tabFor(pathname);
  const isOverview = pathname.replace(/\/+$/, '') === '/accounting';
  const onTabKeyDown = useTabKeyboardNav<TabId>({
    ids: TAB_IDS,
    activeId: active,
    onChange: (id) => navigate(TAB_PATH[id]),
  });
  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: t('accounting.tab_overview', { defaultValue: 'Overview' }), icon: LayoutDashboard },
    { id: 'accounts', label: t('accounting.tab_accounts', { defaultValue: 'Chart of accounts' }), icon: ListTree },
    { id: 'journal', label: t('accounting.tab_journal', { defaultValue: 'Journal' }), icon: BookOpen },
    { id: 'reports', label: t('accounting.tab_reports', { defaultValue: 'Reports' }), icon: BarChart3 },
  ];
  const moduleName = t('accounting.title', { defaultValue: 'Accounting' });
  const crumbs = isOverview
    ? [{ label: moduleName }]
    : [
        { label: moduleName, to: '/accounting' },
        ...(parent ? [{ label: parent.label, to: parent.to }] : []),
        { label: title },
      ];

  return (
    <div className="space-y-5">
      <Breadcrumb items={crumbs} />

      <PageHeader
        srTitle={title}
        subtitle={t('accounting.subtitle', {
          defaultValue: 'General ledger, journal entries and financial reports for your business.',
        })}
        actions={
          <>
            <ModuleGuideButton content={accountingGuide} onCta={() => navigate('/accounting/journal/new')} />
            {actions}
          </>
        }
      />

      {isOverview && (
        <DismissibleInfo
          storageKey="accounting"
          title={t('accounting.intro_title', { defaultValue: 'Every transaction, in one ledger' })}
          links={[
            { label: t('accounting.intro_link_sales', { defaultValue: 'Sales' }), onClick: () => navigate('/sales') },
            { label: t('accounting.intro_link_purchasing', { defaultValue: 'Purchasing' }), onClick: () => navigate('/purchasing') },
            { label: t('accounting.intro_link_banking', { defaultValue: 'Banking' }), onClick: () => navigate('/banking') },
          ]}
        >
          {t('accounting.intro_body', {
            defaultValue:
              'Invoices, supplier bills and payments post to the ledger automatically. Review the journal, add manual entries for anything without a document, and run the trial balance, profit and loss and balance sheet for any period.',
          })}
        </DismissibleInfo>
      )}

      <div className="border-b border-border-light">
        <nav
          className="flex gap-1 -mb-px"
          role="tablist"
          aria-label={t('accounting.sections', { defaultValue: 'Accounting sections' })}
          onKeyDown={onTabKeyDown}
        >
          {tabs.map((x) => {
            const Icon = x.icon;
            const isActive = active === x.id;
            return (
              <button
                key={x.id}
                type="button"
                role="tab"
                id={`accounting-tab-${x.id}`}
                aria-selected={isActive}
                aria-controls="accounting-panel"
                tabIndex={isActive ? 0 : -1}
                onClick={() => navigate(TAB_PATH[x.id])}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  isActive
                    ? 'border-oe-blue text-oe-blue'
                    : 'border-transparent text-content-secondary hover:text-content-primary',
                )}
              >
                <Icon size={14} />
                {x.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div id="accounting-panel" role="tabpanel" aria-labelledby={`accounting-tab-${active}`} className="space-y-4">
        {children}
      </div>
    </div>
  );
}

export function LoadingBlock() {
  const { t } = useTranslation();
  return (
    <div role="status" className="rounded-md border border-border-light bg-surface-primary px-3 py-8 text-center text-sm text-content-tertiary">
      {t('common.loading', { defaultValue: 'Loading…' })}
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const msg = error ? getErrorMessage(error) : '';
  return (
    <div role="alert" className="rounded-md border border-border-light bg-surface-primary px-3 py-8 text-center">
      <p className="text-sm text-content-secondary">
        {t('accounting.load_error', { defaultValue: "We couldn't load this right now." })}
      </p>
      {msg && <p className="mt-1 text-xs text-content-tertiary">{msg}</p>}
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
          {t('common.retry', { defaultValue: 'Try again' })}
        </Button>
      )}
    </div>
  );
}

export function EmptyBlock({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-border-light bg-surface-primary px-3 py-10 text-center">
      <p className="text-base font-medium text-content-primary">{title}</p>
      {hint && <p className="mt-1 text-sm text-content-secondary">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block text-xs text-content-tertiary', className)}>
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

const SOURCE_LABELS: Record<string, [string, string]> = {
  sales_invoice: ['source_sales_invoice', 'Sales invoice'],
  sales_payment: ['source_sales_payment', 'Customer payment'],
  customer_payment: ['source_sales_payment', 'Customer payment'],
  purchase_bill: ['source_purchase_bill', 'Supplier bill'],
  supplier_bill: ['source_purchase_bill', 'Supplier bill'],
  vendor_bill: ['source_purchase_bill', 'Supplier bill'],
  business_demo_expense: ['source_expense', 'Expense'],
  expense: ['source_expense', 'Expense'],
  opening_balance: ['source_opening', 'Opening balance'],
  manual: ['source_manual', 'Manual'],
};

/** Human label for a journal entry's raw `source_type`; unknown values are title-cased. */
export function sourceLabel(raw: string | null | undefined, t: (k: string, o: { defaultValue: string }) => string): string {
  const key = (raw ?? '').trim().toLowerCase();
  if (!key) return t('accounting.source_manual', { defaultValue: 'Manual' });
  const hit = SOURCE_LABELS[key];
  if (hit) return t(`accounting.${hit[0]}`, { defaultValue: hit[1] });
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function SourceChip({ source }: { source: string | null | undefined }) {
  const { t } = useTranslation();
  return (
    <span className="inline-block rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-content-secondary">
      {sourceLabel(source, t)}
    </span>
  );
}
