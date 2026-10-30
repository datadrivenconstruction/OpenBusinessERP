import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, FileText, PackageCheck, Plus, Search, ShoppingCart } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { Card, Breadcrumb, EmptyState, SkeletonTable, DismissibleInfo, ModuleGuideButton } from '@/shared/ui';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { PageHeader } from '@/shared/ui/PageHeader';
import { getErrorMessage, triggerDownload } from '@/shared/lib/api';
import { useTabKeyboardNav } from '@/shared/hooks/useTabKeyboardNav';
import { useToastStore } from '@/stores/useToastStore';
import { InsightsPanel, InsightsToggleButton, useModuleInsights } from '@/features/insights';
import { purchasingGuide } from './purchasingGuide';
import { buildPurchasingInsights } from './purchasingInsights';
import { PURCHASING_TABS, docKind, purchasingApi, type BulkAction, type PurchasingDocSummary, type PurchasingKind, type PurchasingTab } from './api';
import { docsToCsv, filtersFromParams, filtersToParams, nextSort, sortDocs, toListQuery, type ListFilters } from './helpers';
import { useDuplicateDoc, useInvalidatePurchasing, usePurchasingList } from './hooks';
import { PurchasingKpis } from './components/PurchasingKpis';
import { PurchasingFilters } from './components/PurchasingFilters';
import { PurchasingTable } from './components/PurchasingTable';
import { ReceiptsTable } from './components/ReceiptsTable';
import { BulkActionBar } from './components/BulkActionBar';
import { openPdfInTab } from './components/PdfPreviewPanel';
import type { RowAction } from './components/RowActionsMenu';
import { ReceiveDialog } from './modals/ReceiveDialog';
import { PaymentDialog } from './modals/PaymentDialog';
import { PaymentRunDialog } from './modals/PaymentRunDialog';

const TAB_LABEL: Record<PurchasingTab, string> = { orders: 'Purchase orders', receipts: 'Receipts', bills: 'Bills' };
const TAB_ICON: Record<PurchasingTab, React.ElementType> = { orders: ShoppingCart, receipts: PackageCheck, bills: FileText };
const PAGE = 50;

export function PurchasingListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const invalidate = useInvalidatePurchasing();
  const [params, setParams] = useSearchParams();
  const tab = (PURCHASING_TABS.includes(params.get('tab') as PurchasingTab) ? params.get('tab') : 'orders') as PurchasingTab;
  const isOrder = tab === 'orders';
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const setFilters = useCallback(
    (f: ListFilters) => setParams((p) => filtersToParams(f, p), { replace: true }),
    [setParams],
  );
  const [limit, setLimit] = useState(PAGE);
  const query = useMemo(() => toListQuery(filters, limit, 0), [filters, limit]);

  const orders = usePurchasingList('orders', query, tab === 'orders');
  const bills = usePurchasingList('bills', query, tab === 'bills');
  const credits = usePurchasingList('credit-notes', { ...query, match: undefined }, tab === 'bills' && !filters.match);
  const receipts = useQuery({ queryKey: ['purchasing', 'receipts'], queryFn: purchasingApi.receipts, enabled: tab === 'receipts', retry: false });

  const docs = useMemo<PurchasingDocSummary[]>(() => {
    if (isOrder) return orders.data?.items ?? [];
    return sortDocs([...(bills.data?.items ?? []), ...(credits.data?.items ?? []).map((c) => ({ ...c, kind: 'credit_note' as const }))], filters.sort);
  }, [isOrder, orders.data, bills.data, credits.data, filters.sort]);
  const total = isOrder ? (orders.data?.total ?? 0) : (bills.data?.total ?? 0) + (credits.data?.total ?? 0);
  const listQ = tab === 'receipts' ? receipts : isOrder ? orders : bills;

  const receiptRows = useMemo(() => {
    const n = filters.q.toLowerCase();
    return (receipts.data ?? []).filter(
      (r) =>
        (!n || r.number.toLowerCase().includes(n) || (r.supplier_name || '').toLowerCase().includes(n) || r.order_number.toLowerCase().includes(n)) &&
        (!filters.date_from || r.doc_date >= filters.date_from) &&
        (!filters.date_to || r.doc_date <= filters.date_to),
    );
  }, [receipts.data, filters]);

  // selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedDocs = docs.filter((d) => selected.has(d.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setSelected((s) => (docs.every((d) => s.has(d.id)) ? new Set() : new Set(docs.map((d) => d.id))));

  const switchTab = (k: PurchasingTab, extra: Record<string, string> = {}) => {
    setSelected(new Set());
    setLimit(PAGE);
    setParams({ tab: k, ...extra });
  };

  // actions
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const [payBill, setPayBill] = useState<PurchasingDocSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const duplicate = useDuplicateDoc();
  const fail = (e: unknown) => addToast({ type: 'error', title: getErrorMessage(e) });

  const bulk = useMutation({
    mutationFn: async ({ action, list }: { action: BulkAction; list: PurchasingDocSummary[] }) => {
      const byKind = new Map<PurchasingKind, string[]>();
      for (const d of list) byKind.set(docKind(d), [...(byKind.get(docKind(d)) ?? []), d.id]);
      let processed = 0;
      let skipped = 0;
      for (const [k, ids] of byKind) {
        const r = await purchasingApi.bulk(k, action, ids);
        processed += r.processed;
        skipped += r.skipped.length;
      }
      return { processed, skipped };
    },
    onSuccess: (r) => {
      void invalidate();
      setSelected(new Set());
      addToast({
        type: r.skipped ? 'warning' : 'success',
        title: t('purchasing.bulk_done', { defaultValue: '{{processed}} processed, {{skipped}} skipped', ...r }),
      });
    },
    onError: fail,
  });
  const toBill = useMutation({
    mutationFn: (fn: () => Promise<{ id: string }>) => fn(),
    onSuccess: (d) => {
      void invalidate();
      navigate(`/purchasing/bills/${d.id}`);
    },
    onError: fail,
  });

  const exportCsv = (list: PurchasingDocSummary[]) =>
    triggerDownload(new Blob(['﻿' + docsToCsv(list)], { type: 'text/csv;charset=utf-8' }), `purchasing-${tab}-${new Date().toISOString().slice(0, 10)}.csv`);

  const onRowAction = (a: RowAction, d: PurchasingDocSummary) => {
    const k = docKind(d);
    if (a === 'pdf') openPdfInTab(k, d.id).catch(fail);
    else if (a === 'mark_sent') bulk.mutate({ action: 'mark_sent', list: [d] });
    else if (a === 'duplicate')
      duplicate.mutate({ kind: k, id: d.id }, { onSuccess: (n) => navigate(`/purchasing/${k}/${n.id}`), onError: fail });
    else if (a === 'receive') setReceiveId(d.id);
    else if (a === 'bill') toBill.mutate(() => purchasingApi.billFromOrder(d.id));
    else if (a === 'pay') setPayBill(d);
  };

  const onTabKeyDown = useTabKeyboardNav<PurchasingTab>({ ids: PURCHASING_TABS, activeId: tab, onChange: (k) => switchTab(k), orientation: 'horizontal' });

  const insights = useModuleInsights('purchasing', { defaultOpen: false });
  const { datasets: insightDatasets, builtins: insightBuiltins } = useMemo(
    () =>
      buildPurchasingInsights(
        tab === 'receipts'
          ? receiptRows.map((r) => ({ supplier_name: r.supplier_name, status: r.status, doc_date: r.doc_date, currency: r.currency, total: r.value_total }))
          : docs.map((d) => ({
              supplier_name: d.supplier_name,
              status: d.status,
              doc_date: d.doc_date,
              currency: d.currency,
              total: d.gross_total,
              amount_paid: tab === 'bills' ? (d.amount_paid ?? 0) : undefined,
              credit: d.kind === 'credit_note',
            })),
        tab,
        t,
      ),
    [tab, docs, receiptRows, t],
  );

  const newTo = tab === 'bills' ? '/purchasing/bills/new' : '/purchasing/orders/new';
  const newLabel = tab === 'bills' ? t('purchasing.new_bills', { defaultValue: 'New bill' }) : t('purchasing.new_orders', { defaultValue: 'New purchase order' });
  const noRows = tab === 'receipts' ? receiptRows.length === 0 : docs.length === 0;
  const filtersActive = params.toString().replace(/(^|&)tab=[^&]*/, '').length > 0;
  const draftCount = selectedDocs.filter((d) => d.status === 'draft').length;

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: t('purchasing.title', { defaultValue: 'Purchasing' }) }]} />
      <PageHeader
        srTitle={t('purchasing.title', { defaultValue: 'Purchasing' })}
        subtitle={t('purchasing.subtitle', { defaultValue: 'Purchase orders, goods receipts and supplier bills, matched step by step.' })}
        actions={
          <>
            <InsightsToggleButton open={insights.open} onClick={insights.toggle} />
            <ModuleGuideButton content={purchasingGuide} onCta={() => navigate('/purchasing/orders/new')} />
            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => navigate(newTo)}>
              {newLabel}
            </Button>
          </>
        }
      />

      <PurchasingKpis onJump={(k, patch) => switchTab(k, patch)} />

      <InsightsPanel
        open={insights.open}
        title={t('purchasing.insights.title', { defaultValue: 'Purchasing insights' })}
        datasets={insightDatasets}
        builtins={insightBuiltins}
        custom={insights.custom}
        onAdd={insights.addCustom}
        onUpdate={insights.updateCustom}
        onRemove={insights.removeCustom}
        onCollapse={() => insights.setOpen(false)}
      />

      <DismissibleInfo
        storageKey="purchasing"
        title={t('purchasing.intro_title', { defaultValue: 'Pay only for what you ordered and received' })}
        links={[
          { label: t('purchasing.intro_link_contacts', { defaultValue: 'Contacts' }), onClick: () => navigate('/contacts') },
          { label: t('purchasing.intro_link_accounting', { defaultValue: 'Accounting' }), onClick: () => navigate('/accounting') },
          { label: t('purchasing.intro_link_banking', { defaultValue: 'Banking' }), onClick: () => navigate('/banking') },
        ]}
      >
        {t('purchasing.intro_body', {
          defaultValue:
            'Raise a purchase order, receive the goods, then turn the receipt into a supplier bill. Each bill is checked against the order price and the received quantity before it is posted and paid.',
        })}
      </DismissibleInfo>

      <div className="border-b border-border-light">
        <nav className="-mb-px flex gap-1" role="tablist" aria-label={t('purchasing.tabs_aria', { defaultValue: 'Purchasing sections' })} onKeyDown={onTabKeyDown}>
          {PURCHASING_TABS.map((k) => {
            const Icon = TAB_ICON[k];
            const active = k === tab;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                id={`purchasing-tab-${k}`}
                aria-selected={active}
                aria-controls={`purchasing-panel-${k}`}
                tabIndex={active ? 0 : -1}
                onClick={() => switchTab(k)}
                className={clsx(
                  'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  active ? 'border-oe-blue text-oe-blue' : 'border-transparent text-content-secondary hover:text-content-primary',
                )}
              >
                <Icon size={14} />
                {t(`purchasing.tab_${k}`, { defaultValue: TAB_LABEL[k] })}
              </button>
            );
          })}
        </nav>
      </div>

      <PurchasingFilters tab={tab} value={filters} onChange={setFilters} />

      {tab !== 'receipts' && (
        <BulkActionBar
          count={selected.size}
          isOrder={isOrder}
          busy={bulk.isPending}
          onExport={() => exportCsv(selectedDocs)}
          onMarkSent={() => bulk.mutate({ action: 'mark_sent', list: selectedDocs })}
          onDeleteDrafts={() => setConfirmDelete(true)}
          onPaymentRun={isOrder ? undefined : () => setRunOpen(true)}
          onClear={() => setSelected(new Set())}
        />
      )}

      <Card padding="none" role="tabpanel" id={`purchasing-panel-${tab}`} aria-labelledby={`purchasing-tab-${tab}`}>
        {listQ.isLoading ? (
          <div className="p-4">
            <SkeletonTable rows={8} columns={isOrder ? 10 : 11} />
          </div>
        ) : listQ.error ? (
          <EmptyState
            icon={<AlertTriangle size={22} />}
            title={t('purchasing.load_error', { defaultValue: "We couldn't load this list right now." })}
            description={getErrorMessage(listQ.error)}
            action={{ label: t('common.retry', { defaultValue: 'Try again' }), onClick: () => void listQ.refetch() }}
          />
        ) : noRows ? (
          filtersActive ? (
            <EmptyState
              icon={<Search size={22} />}
              title={t('common.no_results', { defaultValue: 'No results found' })}
              action={{ label: t('common.clear_filters', { defaultValue: 'Clear filters' }), onClick: () => switchTab(tab) }}
            />
          ) : (
            <EmptyState
              icon={<ShoppingCart size={22} />}
              title={t(`purchasing.empty_${tab}`, { defaultValue: `No ${TAB_LABEL[tab].toLowerCase()} yet` })}
              action={tab !== 'receipts' ? { label: newLabel, onClick: () => navigate(newTo) } : undefined}
            />
          )
        ) : tab === 'receipts' ? (
          <ReceiptsTable rows={receiptRows} busy={toBill.isPending} onBill={(id) => toBill.mutate(() => purchasingApi.billFromReceipt(id))} />
        ) : (
          <>
            <PurchasingTable
              isOrder={isOrder}
              rows={docs}
              sort={filters.sort}
              onSort={(f) => setFilters({ ...filters, sort: nextSort(filters.sort, f) })}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onAction={onRowAction}
            />
            <div className="flex items-center justify-between border-t border-border-light px-4 py-2 text-xs text-content-tertiary">
              <span>{t('purchasing.showing', { defaultValue: 'Showing {{shown}} of {{total}}', shown: docs.length, total })}</span>
              {docs.length < total && (
                <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
                  {t('purchasing.load_more', { defaultValue: 'Load more' })}
                </Button>
              )}
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        variant="danger"
        loading={bulk.isPending}
        title={t('purchasing.delete_drafts_title', { defaultValue: 'Delete draft documents?' })}
        message={t('purchasing.delete_drafts_msg', {
          defaultValue: '{{drafts}} of {{count}} selected documents are drafts and will be deleted. Posted documents are skipped.',
          drafts: draftCount,
          count: selected.size,
        })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          bulk.mutate({ action: 'delete_drafts', list: selectedDocs });
        }}
      />
      <ReceiveDialog orderId={receiveId} onClose={() => setReceiveId(null)} />
      <PaymentDialog bill={payBill} onClose={() => setPayBill(null)} />
      <PaymentRunDialog open={runOpen} bills={selectedDocs} onClose={() => setRunOpen(false)} onExport={() => exportCsv(selectedDocs)} />
    </div>
  );
}
