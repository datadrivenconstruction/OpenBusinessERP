import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, FileCheck2, FileText, Plus, Receipt, Repeat, Search, ShoppingBag } from 'lucide-react';
import {
  Breadcrumb,
  Button,
  Card,
  ConfirmDialog,
  DismissibleInfo,
  EmptyState,
  ModuleGuideButton,
  SkeletonTable,
} from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { getErrorMessage, triggerDownload } from '@/shared/lib/api';
import { useTabKeyboardNav } from '@/shared/hooks/useTabKeyboardNav';
import { useToastStore } from '@/stores/useToastStore';
import { InsightsPanel, InsightsToggleButton, useModuleInsights } from '@/features/insights';
import { salesGuide } from './salesGuide';
import { buildSalesInsights } from './salesInsights';
import { SALES_KINDS, fetchSalesPdf, kindPath, type BulkAction, type BulkResult, type SalesDocSummary, type SalesKind } from './api';
import { useBulkAction, useDuplicate, useSalesList, useSalesStats } from './hooks';
import { PAGE_SIZE, clearFilters, filtersFromParams, filtersToParams, hasActiveFilters, toListQuery, type SalesFilters } from './lib/filters';
import { salesDocsCsv } from './lib/csv';
import { SalesKpiStrip } from './components/SalesKpiStrip';
import { SalesFiltersBar } from './components/SalesFiltersBar';
import { SalesTable } from './components/SalesTable';
import { BulkActionBar } from './components/BulkActionBar';
import type { RowActionHandlers } from './components/RowActions';
import { ReminderDraftsModal } from './modals/ReminderDraftsModal';
import { ConvertDialog } from './modals/ConvertDialog';
import { RecordPaymentModal } from './modals/RecordPaymentModal';
import { SendDocModal } from './modals/SendDocModal';

const KIND_LABEL: Record<SalesKind, string> = { quotes: 'Quotes', orders: 'Orders', invoices: 'Invoices', 'credit-notes': 'Credit notes' };
const KIND_ICON: Record<SalesKind, React.ElementType> = { quotes: FileText, orders: ShoppingBag, invoices: Receipt, 'credit-notes': FileCheck2 };

type Dialog =
  | { type: 'send' | 'convert' | 'pay'; doc: SalesDocSummary }
  | { type: 'reminders'; result: BulkResult }
  | { type: 'delete' }
  | null;

export function SalesListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToastStore((s) => s.addToast);
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const setFilters = useCallback((f: SalesFilters) => setParams(filtersToParams(f), { replace: true }), [setParams]);
  const kind = filters.tab;
  const query = useMemo(() => toListQuery(filters), [filters]);
  const list = useSalesList(kind, query);
  const stats = useSalesStats();
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const bulk = useBulkAction(kind);
  const duplicate = useDuplicate(kind);
  const newLabel = t(`sales.new_${kind}`, { defaultValue: `New ${KIND_LABEL[kind].slice(0, -1).toLowerCase()}` });
  const noun = KIND_LABEL[kind].toLowerCase();

  const switchTab = (k: SalesKind) => {
    setSelected(new Set());
    setFilters({ ...clearFilters(filters), tab: k, sort: filters.sort });
  };
  const onTabKeyDown = useTabKeyboardNav<SalesKind>({ ids: SALES_KINDS, activeId: kind, onChange: switchTab, orientation: 'horizontal' });

  const insights = useModuleInsights('sales', { defaultOpen: false });
  const { datasets: insightDatasets, builtins: insightBuiltins } = useMemo(
    () =>
      buildSalesInsights(
        rows.map((d) => ({
          customer_name: d.customer_name,
          status: d.status,
          doc_date: d.doc_date,
          currency: d.currency,
          total: d.gross_total,
          amount_paid: kind === 'invoices' ? d.amount_paid : undefined,
          credit: kind === 'credit-notes',
        })),
        kind,
        t,
      ),
    [rows, kind, t],
  );

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const fail = (e: unknown) => toast({ type: 'error', title: getErrorMessage(e) });
  const runBulk = (action: BulkAction) =>
    bulk.mutate(
      { action, ids: [...selected] },
      {
        onSuccess: (res) => {
          setSelected(new Set());
          if (action === 'reminder_drafts') setDialog({ type: 'reminders', result: res });
          else {
            setDialog(null);
            toast({
              type: res.skipped.length ? 'warning' : 'success',
              title: t('sales.bulk.done', {
                defaultValue: '{{processed}} processed, {{skipped}} skipped',
                processed: res.processed,
                skipped: res.skipped.length,
              }),
              message: res.skipped.map((s) => s.reason).slice(0, 3).join('; ') || undefined,
            });
          }
        },
        onError: fail,
      },
    );
  const exportCsv = () => {
    const docs = selectedRows.length ? selectedRows : rows;
    triggerDownload(new Blob(['\uFEFF' + salesDocsCsv(docs)], { type: 'text/csv;charset=utf-8' }), `sales-${kind}.csv`);
  };

  const actions: RowActionHandlers = {
    pdf: (d) => fetchSalesPdf(kindPath(d.kind), d.id).then((b) => triggerDownload(b, `${d.kind}-${d.number}.pdf`), fail),
    send: (d) => setDialog({ type: 'send', doc: d }),
    duplicate: (d) =>
      duplicate.mutate(d.id, { onSuccess: (n) => navigate(`/sales/${kindPath(n.kind)}/${n.id}`), onError: fail }),
    convert: (d) => setDialog({ type: 'convert', doc: d }),
    pay: (d) => setDialog({ type: 'pay', doc: d }),
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersActive = hasActiveFilters(filters);

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: t('sales.title', { defaultValue: 'Sales' }) }]} />
      <PageHeader
        srTitle={t('sales.title', { defaultValue: 'Sales' })}
        subtitle={t('sales.subtitle', { defaultValue: 'Quotes, orders, invoices and credit notes for your customers.' })}
        actions={
          <>
            <InsightsToggleButton open={insights.open} onClick={insights.toggle} />
            <ModuleGuideButton content={salesGuide} onCta={() => navigate(`/sales/${kind}/new`)} />
            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => navigate(`/sales/${kind}/new`)}>
              {newLabel}
            </Button>
          </>
        }
      />

      <SalesKpiStrip
        stats={stats.data}
        loading={stats.isLoading}
        onOpenQuotes={() => setFilters({ ...clearFilters(filters), tab: 'quotes', status: ['draft', 'sent'] })}
        onOrdersToInvoice={() => setFilters({ ...clearFilters(filters), tab: 'orders', status: ['confirmed', 'delivered'] })}
        onInvoices={() => setFilters({ ...clearFilters(filters), tab: 'invoices' })}
        onOverdue={() => setFilters({ ...clearFilters(filters), tab: 'invoices', overdue: true })}
      />

      <InsightsPanel
        open={insights.open}
        title={t('sales.insights.title', { defaultValue: 'Sales insights' })}
        datasets={insightDatasets}
        builtins={insightBuiltins}
        custom={insights.custom}
        onAdd={insights.addCustom}
        onUpdate={insights.updateCustom}
        onRemove={insights.removeCustom}
        onCollapse={() => insights.setOpen(false)}
      />

      <DismissibleInfo
        storageKey="sales"
        title={t('sales.intro_title', { defaultValue: 'From quote to cash in one flow' })}
        links={[
          { label: t('sales.intro_link_contacts', { defaultValue: 'Contacts' }), onClick: () => navigate('/contacts') },
          { label: t('sales.intro_link_receivables', { defaultValue: 'Receivables' }), onClick: () => navigate('/receivables') },
          { label: t('sales.intro_link_accounting', { defaultValue: 'Accounting' }), onClick: () => navigate('/accounting') },
        ]}
      >
        {t('sales.intro_body', {
          defaultValue:
            'Each document is created from the previous one: a quote becomes an order, an order becomes an invoice. Issued invoices are posted to the ledger and show up in Receivables until they are paid.',
        })}
      </DismissibleInfo>

      <div className="border-b border-border-light">
        <nav className="-mb-px flex gap-1 overflow-x-auto" role="tablist" aria-label={t('sales.tabs_aria', { defaultValue: 'Sales sections' })} onKeyDown={onTabKeyDown}>
          {SALES_KINDS.map((k) => {
            const Icon = KIND_ICON[k];
            const active = k === kind;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                id={`sales-tab-${k}`}
                aria-selected={active}
                aria-controls={`sales-panel-${k}`}
                tabIndex={active ? 0 : -1}
                onClick={() => switchTab(k)}
                className={clsx(
                  'flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  active ? 'border-oe-blue text-oe-blue' : 'border-transparent text-content-secondary hover:text-content-primary',
                )}
              >
                <Icon size={14} />
                {t(`sales.tab_${k}`, { defaultValue: KIND_LABEL[k] })}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => navigate('/sales/recurring')}
            className="flex items-center gap-2 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-content-secondary transition-colors hover:text-content-primary"
          >
            <Repeat size={14} />
            {t('sales.tab_recurring', { defaultValue: 'Recurring' })}
          </button>
        </nav>
      </div>

      <SalesFiltersBar filters={filters} onChange={setFilters} />

      <BulkActionBar
        kind={kind}
        count={selected.size}
        busy={bulk.isPending}
        onReminders={() => runBulk('reminder_drafts')}
        onExport={exportCsv}
        onMarkSent={() => runBulk('mark_sent')}
        onDeleteDrafts={() => setDialog({ type: 'delete' })}
        onClear={() => setSelected(new Set())}
      />

      <Card padding="none" role="tabpanel" id={`sales-panel-${kind}`} aria-labelledby={`sales-tab-${kind}`}>
        {list.isLoading ? (
          <div className="p-4">
            <SkeletonTable rows={8} columns={9} />
          </div>
        ) : list.error ? (
          <EmptyState
            icon={<AlertTriangle size={22} />}
            title={t('sales.load_error', { defaultValue: "We couldn't load this list right now." })}
            description={getErrorMessage(list.error)}
            action={{ label: t('common.retry', { defaultValue: 'Try again' }), onClick: () => void list.refetch() }}
          />
        ) : rows.length === 0 ? (
          filtersActive ? (
            <EmptyState
              icon={<Search size={22} />}
              title={t('common.no_results', { defaultValue: 'No results found' })}
              action={{ label: t('common.clear_filters', { defaultValue: 'Clear filters' }), onClick: () => setFilters(clearFilters(filters)) }}
            />
          ) : (
            <EmptyState
              icon={<FileText size={22} />}
              title={t(`sales.empty_title_${kind}`, { defaultValue: `No ${noun} yet` })}
              description={t(`sales.empty_hint_${kind}`, { defaultValue: `Create your first ${noun.slice(0, -1)} and it will show up here.` })}
              action={{ label: newLabel, onClick: () => navigate(`/sales/${kind}/new`) }}
            />
          )
        ) : (
          <>
            <SalesTable
              kind={kind}
              rows={rows}
              sort={filters.sort}
              onSort={(sort) => setFilters({ ...filters, sort, page: 1 })}
              selected={selected}
              onToggle={toggle}
              onToggleAll={(on) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set())}
              actions={actions}
            />
            <div className="flex items-center justify-between border-t border-border-light px-4 py-2 text-xs text-content-tertiary">
              <span>{t('sales.count', { defaultValue: '{{count}} documents', count: total })}</span>
              {pages > 1 && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>
                    {t('common.previous', { defaultValue: 'Previous' })}
                  </Button>
                  <span>
                    {filters.page} / {pages}
                  </span>
                  <Button size="sm" variant="ghost" disabled={filters.page >= pages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>
                    {t('common.next', { defaultValue: 'Next' })}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        variant="danger"
        loading={bulk.isPending}
        title={t('sales.bulk.delete_title', { defaultValue: 'Delete selected drafts?' })}
        message={t('sales.bulk.delete_msg', {
          defaultValue: 'Only drafts are deleted; issued or sent documents in the selection are skipped. This cannot be undone.',
        })}
        confirmLabel={t('sales.bulk.delete_drafts', { defaultValue: 'Delete drafts' })}
        onConfirm={() => runBulk('delete_drafts')}
        onCancel={() => setDialog(null)}
      />
      {dialog?.type === 'reminders' && <ReminderDraftsModal result={dialog.result} onClose={() => setDialog(null)} />}
      {dialog?.type === 'send' && <SendDocModal doc={dialog.doc} onClose={() => setDialog(null)} />}
      {dialog?.type === 'pay' && <RecordPaymentModal doc={dialog.doc} onClose={() => setDialog(null)} />}
      {dialog?.type === 'convert' && (
        <ConvertDialog
          doc={dialog.doc}
          onClose={() => setDialog(null)}
          onDone={(d) => navigate(`/sales/${kindPath(d.kind)}/${d.id}`)}
        />
      )}
    </div>
  );
}
