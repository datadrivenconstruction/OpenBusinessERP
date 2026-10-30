import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Boxes, ChevronLeft, ChevronRight, Download, FolderTree,
  Link2, Package, Percent, Plus, Search, SlidersHorizontal, Tag, Upload, Wrench, X,
} from 'lucide-react';
import {
  Badge, Breadcrumb, Button, Card, ConfirmDialog, DismissibleInfo, EmptyState, KpiBand, ModuleGuideButton, SkeletonTable,
} from '@/shared/ui';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { PageHeader } from '@/shared/ui/PageHeader';
import { getErrorMessage, triggerDownload } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { InsightsPanel, InsightsToggleButton, useModuleInsights } from '@/features/insights';
import { ITEM_TYPES, TYPE_VARIANT, itemsApi, marginPct, type BulkInput, type Item, type ItemInput, type SortKey } from './api';
import { itemsGuide } from './itemsGuide';
import { buildItemsInsights } from './itemsInsights';
import {
  PAGE_SIZE, activeFilterCount, itemsToCsv, nextSort, readListState, toFilters, type ListState,
} from './itemsLogic';
import { ItemThumb, MarginText, StockCell, TYPE_LABEL, control } from './components/ItemBits';
import { ItemFormDrawer } from './components/ItemFormDrawer';
import { ItemDetailDrawer } from './components/ItemDetailDrawer';
import { CategoriesDrawer } from './components/CategoriesDrawer';
import { fmtUpTo } from '@/shared/lib/formatters';

type BulkKind = 'set_category' | 'set_tax_code' | 'adjust_prices';

interface Props {
  /** Item id from the /items/:id route ('new' opens the create form). */
  routeId?: string;
}

export function ItemsListPage({ routeId }: Props = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [params, setParams] = useSearchParams();
  const st = readListState(params);
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  const patch = (next: Partial<Record<keyof ListState, string>>, keepPage = false) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!keepPage) p.delete('page');
    setParams(p, { replace: true });
  };

  const filters = toFilters(st);
  const list = useQuery({ queryKey: ['items', 'list', filters], queryFn: () => itemsApi.list(filters), retry: false, placeholderData: (prev) => prev });
  const stats = useQuery({ queryKey: ['items', 'stats'], queryFn: itemsApi.stats, retry: false });
  const cats = useQuery({ queryKey: ['items', 'categories'], queryFn: itemsApi.categories, retry: false });
  const catName = useMemo(() => new Map((cats.data ?? []).map((c) => [c.id, c.name])), [cats.data]);
  const rows = list.data?.items ?? [];
  const onHand = list.data?.on_hand ?? {};
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterCount = activeFilterCount(st);
  const filtered = Boolean(st.q) || filterCount > 0;
  const [showFilters, setShowFilters] = useState(filterCount > 0);

  // ── Drawers ────────────────────────────────────────────────────────────
  const [detail, setDetail] = useState<Item | null>(null);
  const [form, setForm] = useState<{ item: Item | null; seed?: Partial<ItemInput> } | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const routeItem = useQuery({
    queryKey: ['items', 'one', routeId],
    queryFn: () => itemsApi.get(routeId!),
    enabled: !!routeId && routeId !== 'new',
    retry: false,
  });
  useEffect(() => {
    if (routeId === 'new') setForm({ item: null });
    else if (routeItem.data) setDetail(routeItem.data);
  }, [routeId, routeItem.data]);
  const leaveRoute = () => { if (routeId) navigate({ pathname: '/items', search: params.toString() }, { replace: true }); };
  // Keep the open drawer in sync after list refreshes (e.g. after an edit).
  useEffect(() => {
    if (!detail) return;
    const fresh = rows.find((r) => r.id === detail.id);
    if (fresh && fresh !== detail) setDetail(fresh);
  }, [rows, detail]);

  // ── Selection & bulk ───────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [params]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const [bulkKind, setBulkKind] = useState<BulkKind | null>(null);
  const [bulkValue, setBulkValue] = useState('');
  const [bulkTarget, setBulkTarget] = useState<'sales' | 'cost' | 'both'>('sales');
  const [confirmDelete, setConfirmDelete] = useState<Item[] | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['items'] });
  const bulk = useMutation({
    mutationFn: (body: BulkInput) => itemsApi.bulk(body),
    onSuccess: (r, body) => {
      refresh();
      setBulkKind(null);
      setBulkValue('');
      if (body.action === 'delete') { setSelected(new Set()); setDetail(null); }
      addToast({ type: 'success', title: t('items.bulk_done', { defaultValue: '{{n}} item(s) updated', n: r.affected }) });
    },
    onError: (e) => addToast({ type: 'error', title: t('items.bulk_failed', { defaultValue: 'Bulk change failed' }), message: getErrorMessage(e) }),
  });
  const runBulk = (action: BulkInput['action'], extra: Partial<BulkInput> = {}, ids = [...selected]) => bulk.mutate({ ids, action, ...extra });
  const applyBulk = () => {
    if (bulkKind === 'set_category') runBulk('set_category', { category_id: bulkValue || null });
    if (bulkKind === 'set_tax_code') runBulk('set_tax_code', { tax_code: bulkValue.trim() });
    if (bulkKind === 'adjust_prices' && bulkValue) runBulk('adjust_prices', { pct: bulkValue.replace(',', '.'), target: bulkTarget });
  };

  const duplicate = useMutation({
    mutationFn: (it: Item) => itemsApi.duplicate(it.id),
    onSuccess: (copy) => {
      refresh();
      setDetail(null);
      setForm({ item: copy });
      addToast({ type: 'success', title: t('items.duplicated', { defaultValue: 'Copy created as {{sku}} — adjust it and save', sku: copy.sku }) });
    },
    onError: (e) => addToast({ type: 'error', title: getErrorMessage(e) }),
  });

  const exportCsv = async () => {
    try {
      const chosen = rows.filter((r) => selected.has(r.id));
      const data = chosen.length ? { items: chosen, on_hand: onHand } : await itemsApi.list({ ...filters, limit: 500, offset: 0 });
      const csv = itemsToCsv(data.items, catName, data.on_hand);
      triggerDownload(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `products-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      addToast({ type: 'error', title: getErrorMessage(e) });
    }
  };

  // ── Insights ───────────────────────────────────────────────────────────
  const insights = useModuleInsights('items', { defaultOpen: false });
  const { datasets: insightDatasets, builtins: insightBuiltins } = useMemo(() => buildItemsInsights(rows, catName, t), [rows, catName, t]);

  // ── Keyboard ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (detail || form || catsOpen) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'n') { e.preventDefault(); setForm({ item: null }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, form, catsOpen]);
  const rowKey = (e: KeyboardEvent<HTMLTableRowElement>, it: Item) => {
    const moveTo = (el: Element | null | undefined) => (el as HTMLElement | null)?.focus();
    if (e.key === 'Enter') { e.preventDefault(); setDetail(it); }
    else if (e.key === ' ') { e.preventDefault(); toggle(it.id); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(e.currentTarget.nextElementSibling); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveTo(e.currentTarget.previousElementSibling); }
    else if (e.key === 'e') { e.preventDefault(); setForm({ item: it }); }
  };

  const goNew = () => setForm({ item: null });
  const importCsv = () => navigate('/import?target=items');
  const sortHeader = (key: SortKey, label: string, right = false) => {
    const on = st.sort === key;
    const Icon = !on ? ArrowUpDown : st.desc ? ArrowDown : ArrowUp;
    return (
      <th className={clsx('px-3 py-2.5 font-medium', right ? 'text-right' : 'text-left')} aria-sort={on ? (st.desc ? 'descending' : 'ascending') : 'none'}>
        <button
          type="button"
          className={clsx('inline-flex items-center gap-1 uppercase tracking-wide hover:text-content-primary', on && 'text-content-primary')}
          onClick={() => { const n = nextSort(st, key); patch({ sort: n.sort === 'sku' && !n.desc ? '' : n.sort, desc: n.desc ? '1' : '' }); }}
        >
          {label}
          <Icon size={12} className={on ? '' : 'opacity-40'} />
        </button>
      </th>
    );
  };

  const s = stats.data;
  const kpis = s ? [
    { key: 'active', label: t('items.kpi_active', { defaultValue: 'Active items' }), value: s.active, icon: Package, tone: 'blue' as const,
      sub: s.inactive ? t('items.kpi_inactive_sub', { defaultValue: '{{n}} inactive', n: s.inactive }) : undefined,
      onClick: () => patch({ status: '', alert: '', type: '' }) },
    { key: 'mix', label: t('items.kpi_mix', { defaultValue: 'Goods / services' }), value: `${s.goods + s.consumables} / ${s.services}`, icon: Wrench, tone: 'default' as const,
      sub: s.consumables ? t('items.kpi_consumables_sub', { defaultValue: 'incl. {{n}} consumables', n: s.consumables }) : undefined,
      onClick: () => patch({ type: st.type === 'service' ? '' : 'service' }) },
    { key: 'margin', label: t('items.kpi_margin', { defaultValue: 'Average margin' }), icon: Percent,
      value: s.avg_margin_pct === null ? '—' : `${fmtUpTo(Number(s.avg_margin_pct), 3)}%`,
      tone: s.avg_margin_pct === null ? 'default' as const : Number(s.avg_margin_pct) < 0 ? 'danger' as const : Number(s.avg_margin_pct) < 20 ? 'warning' as const : 'success' as const,
      tintValue: true, onClick: () => patch({ sort: 'margin', desc: '' }) },
    { key: 'low', label: t('items.kpi_low_stock', { defaultValue: 'Below minimum stock' }), value: s.below_min_stock, icon: Boxes,
      tone: s.below_min_stock ? 'warning' as const : 'default' as const, tintValue: s.below_min_stock > 0,
      onClick: () => patch({ alert: st.alert === 'below_min' ? '' : 'below_min' }) },
    { key: 'noprice', label: t('items.kpi_no_price', { defaultValue: 'Without a price' }), value: s.without_price, icon: Tag,
      tone: s.without_price ? 'danger' as const : 'default' as const, tintValue: s.without_price > 0,
      onClick: () => patch({ alert: st.alert === 'no_price' ? '' : 'no_price' }) },
  ] : [];

  const catalogueEmpty = s?.total === 0;

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: t('items.title', { defaultValue: 'Products & services' }) }]} />

      <PageHeader
        srTitle={t('items.title', { defaultValue: 'Products & services' })}
        subtitle={t('items.subtitle', { defaultValue: 'The catalogue of goods and services you sell or buy, with prices, costs and accounts.' })}
        actions={
          <>
            <InsightsToggleButton open={insights.open} onClick={insights.toggle} />
            <ModuleGuideButton content={itemsGuide} onCta={goNew} />
            <Button size="sm" variant="secondary" icon={<FolderTree size={14} />} onClick={() => setCatsOpen(true)}>
              {t('items.categories_title', { defaultValue: 'Categories' })}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => navigate('/items/price-lists')}>
              {t('items.price_lists', { defaultValue: 'Price lists' })}
            </Button>
            <Button size="sm" variant="secondary" icon={<Upload size={14} />} onClick={importCsv}>
              {t('items.import_csv', { defaultValue: 'Import CSV' })}
            </Button>
            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={goNew} title={t('items.shortcut_new', { defaultValue: 'Shortcut: N' })}>
              {t('items.new_item', { defaultValue: 'New item' })}
            </Button>
          </>
        }
      />

      <InsightsPanel
        open={insights.open}
        title={t('items.insights.title', { defaultValue: 'Catalogue insights' })}
        datasets={insightDatasets}
        builtins={insightBuiltins}
        custom={insights.custom}
        onAdd={insights.addCustom}
        onUpdate={insights.updateCustom}
        onRemove={insights.removeCustom}
        onCollapse={() => insights.setOpen(false)}
      />

      <DismissibleInfo
        storageKey="items"
        title={t('items.intro_title', { defaultValue: 'One catalogue for everything you sell or buy' })}
        links={[
          { label: t('items.intro_link_sales', { defaultValue: 'Sales' }), onClick: () => navigate('/sales') },
          { label: t('items.intro_link_purchasing', { defaultValue: 'Purchasing' }), onClick: () => navigate('/purchasing') },
          { label: t('items.intro_link_accounting', { defaultValue: 'Accounting' }), onClick: () => navigate('/accounting') },
        ]}
      >
        {t('items.intro_body', {
          defaultValue:
            'Add each product or service once, with its SKU, unit, sales price, purchase cost and accounts. Sales documents and supplier bills pick items from here, so prices and ledger postings stay consistent everywhere.',
        })}
      </DismissibleInfo>

      {!catalogueEmpty && kpis.length > 0 && <KpiBand items={kpis} columns={5} size="sm" />}

      {catalogueEmpty ? (
        <Card>
          <EmptyState
            icon={<Package size={22} />}
            title={t('items.empty_title', { defaultValue: 'No products or services yet' })}
            description={t('items.empty_hint', {
              defaultValue: 'Add the goods and services you sell or buy, or import them from a CSV file with sku and name columns.',
            })}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={goNew}>{t('items.add_first', { defaultValue: 'Add first product' })}</Button>
                <Button variant="secondary" size="sm" icon={<Upload size={14} />} onClick={importCsv}>{t('items.import_from_csv', { defaultValue: 'Import from CSV' })}</Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] max-w-md flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary" />
              <input
                ref={searchRef}
                className={clsx(control, 'pl-8')}
                placeholder={t('items.search_placeholder_kbd', { defaultValue: 'Search by SKU, name or barcode  ( / )' })}
                aria-label={t('items.search_placeholder', { defaultValue: 'Search by SKU, name or barcode' })}
                value={st.q}
                onChange={(e) => patch({ q: e.target.value })}
              />
            </div>
            <div role="group" className="flex rounded-lg border border-border bg-surface-secondary p-0.5 text-xs">
              {(['', ...ITEM_TYPES] as const).map((x) => (
                <button
                  key={x || 'all'}
                  type="button"
                  aria-pressed={st.type === x}
                  onClick={() => patch({ type: x })}
                  className={clsx('h-8 rounded-md px-3 font-medium', st.type === x ? 'bg-surface-primary text-content-primary shadow-sm' : 'text-content-secondary hover:text-content-primary')}
                >
                  {x ? t(`items.type_${x}`, { defaultValue: TYPE_LABEL[x] }) : t('items.all_types', { defaultValue: 'All types' })}
                </button>
              ))}
            </div>
            <Button size="sm" variant={showFilters ? 'primary' : 'secondary'} icon={<SlidersHorizontal size={14} />} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
              {t('items.filters', { defaultValue: 'Filters' })}{filterCount ? ` (${filterCount})` : ''}
            </Button>
            {filtered && (
              <>
                <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                  {t('items.clear_filters', { defaultValue: 'Clear' })}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Link2 size={14} />}
                  onClick={() => {
                    void navigator.clipboard?.writeText(window.location.href);
                    addToast({ type: 'info', title: t('items.link_copied', { defaultValue: 'Link to this view copied' }) });
                  }}
                >
                  {t('items.copy_view_link', { defaultValue: 'Copy link' })}
                </Button>
              </>
            )}
            <span className="ml-auto" />
            <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={() => void exportCsv()}>
              {selected.size ? t('items.export_selected', { defaultValue: 'Export {{n}}', n: selected.size }) : t('items.export_csv', { defaultValue: 'Export CSV' })}
            </Button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-border-light bg-surface-secondary p-3 sm:grid-cols-3 lg:grid-cols-6">
              <select className={control} value={st.category} onChange={(e) => patch({ category: e.target.value })} aria-label={t('items.col_category', { defaultValue: 'Category' })}>
                <option value="">{t('items.all_categories', { defaultValue: 'All categories' })}</option>
                {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className={control} value={st.status} onChange={(e) => patch({ status: e.target.value === 'active' ? '' : e.target.value })} aria-label={t('items.col_status', { defaultValue: 'Status' })}>
                <option value="active">{t('items.status_active', { defaultValue: 'Active' })}</option>
                <option value="inactive">{t('items.status_inactive', { defaultValue: 'Inactive' })}</option>
                <option value="all">{t('items.status_all', { defaultValue: 'Active and inactive' })}</option>
              </select>
              <input className={control} value={st.tax} onChange={(e) => patch({ tax: e.target.value })} placeholder={t('items.tax_code', { defaultValue: 'Tax code' })} aria-label={t('items.tax_code', { defaultValue: 'Tax code' })} />
              <input className={clsx(control, 'text-right')} inputMode="decimal" value={st.min} onChange={(e) => patch({ min: e.target.value })} placeholder={t('items.price_from', { defaultValue: 'Price from' })} aria-label={t('items.price_from', { defaultValue: 'Price from' })} />
              <input className={clsx(control, 'text-right')} inputMode="decimal" value={st.max} onChange={(e) => patch({ max: e.target.value })} placeholder={t('items.price_to', { defaultValue: 'Price to' })} aria-label={t('items.price_to', { defaultValue: 'Price to' })} />
              <select className={control} value={st.alert} onChange={(e) => patch({ alert: e.target.value })} aria-label={t('items.attention', { defaultValue: 'Needs attention' })}>
                <option value="">{t('items.attention_any', { defaultValue: 'Any stock & price' })}</option>
                <option value="below_min">{t('items.kpi_low_stock', { defaultValue: 'Below minimum stock' })}</option>
                <option value="no_price">{t('items.kpi_no_price', { defaultValue: 'Without a price' })}</option>
              </select>
            </div>
          )}

          {selected.size > 0 && (
            <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-oe-blue/30 bg-surface-primary px-3 py-2 shadow-sm" role="toolbar" aria-label={t('items.bulk_toolbar', { defaultValue: 'Bulk actions' })}>
              <span className="text-sm font-medium text-content-primary">{t('items.n_selected', { defaultValue: '{{n}} selected', n: selected.size })}</span>
              <Button size="sm" variant="secondary" disabled={bulk.isPending} onClick={() => runBulk('activate')}>{t('items.activate', { defaultValue: 'Activate' })}</Button>
              <Button size="sm" variant="secondary" disabled={bulk.isPending} onClick={() => runBulk('deactivate')}>{t('items.deactivate', { defaultValue: 'Deactivate' })}</Button>
              <select className={clsx(control, 'h-8 w-auto')} value={bulkKind ?? ''} onChange={(e) => { setBulkKind((e.target.value || null) as BulkKind | null); setBulkValue(''); }} aria-label={t('items.bulk_more', { defaultValue: 'More changes' })}>
                <option value="">{t('items.bulk_more', { defaultValue: 'More changes…' })}</option>
                <option value="set_category">{t('items.bulk_category', { defaultValue: 'Change category' })}</option>
                <option value="set_tax_code">{t('items.bulk_tax', { defaultValue: 'Set tax code' })}</option>
                <option value="adjust_prices">{t('items.bulk_prices', { defaultValue: 'Adjust prices by %' })}</option>
              </select>
              {bulkKind === 'set_category' && (
                <select className={clsx(control, 'h-8 w-48')} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} aria-label={t('items.col_category', { defaultValue: 'Category' })}>
                  <option value="">{t('items.no_category', { defaultValue: 'No category' })}</option>
                  {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              {bulkKind === 'set_tax_code' && (
                <input className={clsx(control, 'h-8 w-36')} value={bulkValue} maxLength={16} onChange={(e) => setBulkValue(e.target.value)} placeholder={t('items.tax_code', { defaultValue: 'Tax code' })} aria-label={t('items.tax_code', { defaultValue: 'Tax code' })} />
              )}
              {bulkKind === 'adjust_prices' && (
                <>
                  <input className={clsx(control, 'h-8 w-24 text-right')} inputMode="decimal" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} placeholder="+5 / -10" aria-label={t('items.pct_change', { defaultValue: 'Change in %' })} />
                  <select className={clsx(control, 'h-8 w-auto')} value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value as typeof bulkTarget)} aria-label={t('items.apply_to', { defaultValue: 'Apply to' })}>
                    <option value="sales">{t('items.col_price', { defaultValue: 'Sales price' })}</option>
                    <option value="cost">{t('items.col_cost', { defaultValue: 'Cost' })}</option>
                    <option value="both">{t('items.price_and_cost', { defaultValue: 'Price and cost' })}</option>
                  </select>
                </>
              )}
              {bulkKind && (
                <Button size="sm" variant="primary" disabled={bulk.isPending || (bulkKind === 'adjust_prices' && !bulkValue)} onClick={applyBulk}>
                  {t('items.apply', { defaultValue: 'Apply' })}
                </Button>
              )}
              <span className="ml-auto" />
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(rows.filter((r) => selected.has(r.id)))}>{t('common.delete', { defaultValue: 'Delete' })}</Button>
              <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setSelected(new Set())} aria-label={t('items.clear_selection', { defaultValue: 'Clear selection' })} />
            </div>
          )}

          <Card padding="none">
            {list.isLoading ? (
              <div className="p-4"><SkeletonTable rows={8} columns={9} /></div>
            ) : list.error ? (
              <EmptyState
                icon={<AlertTriangle size={22} />}
                title={t('items.load_error', { defaultValue: "We couldn't load the item list right now." })}
                action={{ label: t('common.retry', { defaultValue: 'Try again' }), onClick: () => { void list.refetch(); } }}
              />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<Search size={22} />}
                title={t('items.no_matches', { defaultValue: 'No items match these filters.' })}
                action={{ label: t('items.clear_filters', { defaultValue: 'Clear' }), onClick: () => setParams(new URLSearchParams(), { replace: true }) }}
              />
            ) : (
              <div className="overflow-x-auto" aria-busy={list.isFetching}>
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary text-[11px] text-content-tertiary">
                    <tr>
                      <th className="w-10 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={allOnPage}
                          aria-label={t('items.select_page', { defaultValue: 'Select all on this page' })}
                          onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))}
                        />
                      </th>
                      {sortHeader('name', t('items.col_item', { defaultValue: 'Item' }))}
                      <th className="px-3 py-2.5 text-left font-medium uppercase tracking-wide">{t('items.col_category', { defaultValue: 'Category' })}</th>
                      {sortHeader('item_type', t('items.col_type', { defaultValue: 'Type' }))}
                      {sortHeader('uom', t('items.col_uom', { defaultValue: 'Unit' }))}
                      {sortHeader('sales_price', t('items.col_price', { defaultValue: 'Sales price' }), true)}
                      {sortHeader('purchase_cost', t('items.col_cost', { defaultValue: 'Cost' }), true)}
                      {sortHeader('margin', t('items.col_margin', { defaultValue: 'Margin' }), true)}
                      {sortHeader('tax_code', t('items.col_tax', { defaultValue: 'Tax' }))}
                      <th className="px-3 py-2.5 text-right font-medium uppercase tracking-wide">{t('items.col_stock', { defaultValue: 'In stock' })}</th>
                      <th className="px-3 py-2.5 text-left font-medium uppercase tracking-wide">{t('items.col_status', { defaultValue: 'Status' })}</th>
                    </tr>
                  </thead>
                  <tbody ref={tableRef}>
                    {rows.map((it) => {
                      const m = marginPct(it.sales_price, it.purchase_cost);
                      const sel = selected.has(it.id);
                      return (
                        <tr
                          key={it.id}
                          tabIndex={0}
                          aria-selected={sel}
                          onClick={() => setDetail(it)}
                          onKeyDown={(e) => rowKey(e, it)}
                          className={clsx('cursor-pointer border-t border-border-light outline-none hover:bg-surface-secondary focus-visible:bg-oe-blue/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oe-blue/40',
                            sel && 'bg-oe-blue/5', !it.active && 'opacity-60')}
                        >
                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={sel} onChange={() => toggle(it.id)} aria-label={t('items.select_item', { defaultValue: 'Select {{name}}', name: it.name })} />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2.5">
                              <ItemThumb item={it} />
                              <div className="min-w-0">
                                <div className="truncate font-medium text-content-primary">{it.name}</div>
                                <div className="font-mono text-xs text-content-tertiary">{it.sku}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {it.category_id && catName.get(it.category_id) ? (
                              <button
                                type="button"
                                className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-content-secondary hover:bg-surface-tertiary"
                                onClick={(e) => { e.stopPropagation(); patch({ category: it.category_id! }); setShowFilters(true); }}
                              >
                                {catName.get(it.category_id)}
                              </button>
                            ) : <span className="text-content-tertiary">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            <Badge size="sm" variant={TYPE_VARIANT[it.item_type]}>{t(`items.type_${it.item_type}`, { defaultValue: TYPE_LABEL[it.item_type] })}</Badge>
                          </td>
                          <td className="px-3 py-2 text-content-secondary">{it.uom}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {Number(it.sales_price) > 0 ? <MoneyDisplay amount={it.sales_price} currency={it.currency} /> : (
                              <span className="text-xs text-semantic-error">{t('items.no_price', { defaultValue: 'no price' })}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-content-secondary"><MoneyDisplay amount={it.purchase_cost} currency={it.currency} /></td>
                          <td className="px-3 py-2 text-right"><MarginText pct={m} /></td>
                          <td className="px-3 py-2 text-content-secondary">{it.tax_code || '—'}</td>
                          <td className="px-3 py-2 text-right"><StockCell item={it} onHand={onHand[it.id]} /></td>
                          <td className="px-3 py-2">
                            <Badge size="sm" variant={it.active ? 'success' : 'neutral'}>
                              {it.active ? t('items.status_active', { defaultValue: 'Active' }) : t('items.status_inactive', { defaultValue: 'Inactive' })}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-content-tertiary">
              <span>
                {t('items.range_of', {
                  defaultValue: '{{from}}–{{to}} of {{total}}',
                  from: (st.page - 1) * PAGE_SIZE + 1, to: Math.min(st.page * PAGE_SIZE, total), total,
                })}
                <span className="ml-3 hidden sm:inline">{t('items.kbd_hint', { defaultValue: '↑↓ move · Enter open · Space select · E edit · N new' })}</span>
              </span>
              {pages > 1 && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" icon={<ChevronLeft size={14} />} disabled={st.page <= 1} onClick={() => patch({ page: String(st.page - 1) }, true)} aria-label={t('items.prev_page', { defaultValue: 'Previous page' })} />
                  <span className="tabular-nums">{st.page} / {pages}</span>
                  <Button size="sm" variant="ghost" icon={<ChevronRight size={14} />} disabled={st.page >= pages} onClick={() => patch({ page: String(st.page + 1) }, true)} aria-label={t('items.next_page', { defaultValue: 'Next page' })} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ItemDetailDrawer
        item={form ? null : detail}
        onHand={detail ? onHand[detail.id] : undefined}
        categoryName={detail?.category_id ? catName.get(detail.category_id) : undefined}
        onClose={() => { setDetail(null); leaveRoute(); }}
        onEdit={(it) => setForm({ item: it })}
        onDuplicate={(it) => duplicate.mutate(it)}
        onToggleActive={(it) => runBulk(it.active ? 'deactivate' : 'activate', {}, [it.id])}
        onDelete={(it) => setConfirmDelete([it])}
      />
      <ItemFormDrawer
        open={!!form}
        item={form?.item ?? null}
        seed={form?.seed}
        onClose={() => { setForm(null); if (routeId === 'new') leaveRoute(); }}
        onSaved={(saved) => { setForm(null); setDetail(saved); if (routeId === 'new') leaveRoute(); }}
      />
      <CategoriesDrawer
        open={catsOpen}
        onClose={() => setCatsOpen(false)}
        onPick={(id) => { setCatsOpen(false); patch({ category: id }); setShowFilters(true); }}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title={t('items.delete_title', { defaultValue: 'Delete {{n}} item(s)?', n: confirmDelete?.length ?? 0 })}
        message={t('items.confirm_delete_many', {
          defaultValue: 'Price list entries for them are removed too. Past documents keep their lines. To keep history tidy, consider deactivating instead.',
        })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        loading={bulk.isPending}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { const ids = (confirmDelete ?? []).map((r) => r.id); setConfirmDelete(null); runBulk('delete', {}, ids); leaveRoute(); }}
      />
    </div>
  );
}

