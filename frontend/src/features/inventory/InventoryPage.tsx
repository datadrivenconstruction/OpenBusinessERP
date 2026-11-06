import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeftRight, ClipboardList, SlidersHorizontal } from 'lucide-react';
import { Badge, Button, KpiBand, TabBar } from '@/shared/ui';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { DateDisplay } from '@/shared/ui/DateDisplay';
import { PageHeader } from '@/shared/ui/PageHeader';
import { fmtUpTo } from '@/shared/lib/formatters';
import { MOVE_KINDS, inventoryApi, sourceLink, type Movement } from './api';
import { AdjustDrawer, StocktakesTab, TransferDrawer, WarehousesTab, fieldCls } from './components';
import { DateField } from '@/shared/ui/DateField';

type TabId = 'stock' | 'movements' | 'stocktakes' | 'warehouses';
const PAGE = 50;
export const qtyFmt = (v: string | number) => fmtUpTo(Number(v), 2);
const th = 'px-3 py-2 text-left font-medium';
const thR = 'px-3 py-2 text-right font-medium';

export function KindBadge({ m }: { m: Pick<Movement, 'kind' | 'reversal_of_id'> }) {
  const { t } = useTranslation();
  const variant = m.kind === 'receipt' || m.kind === 'opening' ? 'success' : m.kind === 'delivery' ? 'blue' : 'neutral';
  return (
    <Badge size="sm" variant={variant}>
      {t(`inventory.kind_${m.kind}`, { defaultValue: m.kind.replace('_', ' ') })}
      {m.reversal_of_id ? ` · ${t('inventory.reversal', { defaultValue: 'reversal' })}` : ''}
    </Badge>
  );
}

export function MovementTable({ rows, showItem = true }: { rows: Movement[]; showItem?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-secondary text-xs text-content-tertiary">
          <tr>
            <th className={th}>{t('inventory.col_date', { defaultValue: 'Date' })}</th>
            <th className={th}>{t('inventory.col_kind', { defaultValue: 'Type' })}</th>
            {showItem && <th className={th}>{t('inventory.col_item', { defaultValue: 'Item' })}</th>}
            <th className={th}>{t('inventory.col_warehouse', { defaultValue: 'Warehouse' })}</th>
            <th className={th}>{t('inventory.col_source', { defaultValue: 'Document' })}</th>
            <th className={thR}>{t('inventory.col_qty', { defaultValue: 'Quantity' })}</th>
            <th className={thR}>{t('inventory.col_unit_cost', { defaultValue: 'Unit cost' })}</th>
            <th className={thR}>{t('inventory.col_value', { defaultValue: 'Value' })}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const href = sourceLink(m);
            const q = Number(m.qty);
            return (
              <tr key={m.id} className={clsx('border-t border-border-light', m.reversed && 'text-content-tertiary line-through decoration-content-tertiary/40')}>
                <td className="whitespace-nowrap px-3 py-2"><DateDisplay value={m.move_date} /></td>
                <td className="px-3 py-2"><KindBadge m={m} /></td>
                {showItem && (
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-content-tertiary">{m.sku}</span> {m.item_name}
                  </td>
                )}
                <td className="px-3 py-2 font-mono text-xs">{m.warehouse_code}</td>
                <td className="px-3 py-2 text-content-secondary">
                  {m.source_number ? (href ? <Link className="hover:underline" to={href}>{m.source_number}</Link> : m.source_number) : m.notes || '—'}
                </td>
                <td className={clsx('px-3 py-2 text-right tabular-nums', q < 0 ? 'text-semantic-error' : 'text-semantic-success')}>
                  {q > 0 ? '+' : ''}{qtyFmt(m.qty)} <span className="text-xs text-content-tertiary">{m.uom}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums"><MoneyDisplay amount={m.unit_cost} /></td>
                <td className="px-3 py-2 text-right tabular-nums"><MoneyDisplay amount={m.value} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StockTab({ onTransfer, onAdjust }: { onTransfer: (itemId: string) => void; onAdjust: (itemId: string) => void }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const wh = params.get('warehouse') ?? '';
  const lowOnly = params.get('low') === '1';
  const warehouses = useQuery({ queryKey: ['inventory', 'warehouses'], queryFn: inventoryApi.warehouses });
  const stock = useQuery({
    queryKey: ['inventory', 'stock', { wh, q, lowOnly }],
    queryFn: () => inventoryApi.stock({ warehouse_id: wh || undefined, q: q || undefined, low_only: lowOnly }),
    placeholderData: keepPreviousData,
  });
  const whs = (warehouses.data ?? []).filter((w) => w.active);
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className={clsx(fieldCls, 'max-w-xs')} placeholder={t('inventory.search_items', { defaultValue: 'Search SKU or name' })} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={clsx(fieldCls, 'w-auto')} value={wh} onChange={(e) => setParam('warehouse', e.target.value)} aria-label={t('inventory.col_warehouse', { defaultValue: 'Warehouse' })}>
          <option value="">{t('inventory.all_warehouses', { defaultValue: 'All warehouses' })}</option>
          {whs.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-content-secondary">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setParam('low', e.target.checked ? '1' : '')} />
          {t('inventory.low_only', { defaultValue: 'Below minimum only' })}
        </label>
      </div>
      {stock.data?.length ? (
        <div className="overflow-x-auto rounded-lg border border-border-light">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-xs text-content-tertiary">
              <tr>
                <th className={th}>{t('inventory.col_item', { defaultValue: 'Item' })}</th>
                {!wh && whs.length > 1 && whs.map((w) => <th key={w.id} className={thR}>{w.code}</th>)}
                <th className={thR}>{t('inventory.on_hand', { defaultValue: 'On hand' })}</th>
                <th className={thR}>{t('inventory.reserved', { defaultValue: 'Reserved' })}</th>
                <th className={thR}>{t('inventory.available', { defaultValue: 'Available' })}</th>
                <th className={thR}>{t('inventory.min_stock', { defaultValue: 'Minimum' })}</th>
                <th className={thR}>{t('inventory.avg_cost', { defaultValue: 'Avg. cost' })}</th>
                <th className={thR}>{t('inventory.col_value', { defaultValue: 'Value' })}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {stock.data.map((r) => (
                <tr key={r.item_id} className="border-t border-border-light">
                  <td className="px-3 py-2">
                    <Link to={`/items?item=${r.item_id}`} className="hover:underline">
                      <span className="font-mono text-xs text-content-tertiary">{r.sku}</span> {r.name}
                    </Link>
                    {r.below_min && <Badge size="sm" variant="warning" className="ml-2">{t('inventory.low', { defaultValue: 'Low' })}</Badge>}
                  </td>
                  {!wh && whs.length > 1 && whs.map((w) => <td key={w.id} className="px-3 py-2 text-right tabular-nums text-content-secondary">{qtyFmt(r.by_warehouse[w.id] ?? '0')}</td>)}
                  <td className={clsx('px-3 py-2 text-right font-medium tabular-nums', Number(r.on_hand) < 0 && 'text-semantic-error')}>{qtyFmt(r.on_hand)} <span className="text-xs font-normal text-content-tertiary">{r.uom}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums text-content-secondary">{Number(r.reserved) ? qtyFmt(r.reserved) : '—'}</td>
                  <td className={clsx('px-3 py-2 text-right tabular-nums', Number(r.available) < 0 && 'text-semantic-error')}>{qtyFmt(r.available)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-content-tertiary">{Number(r.min_stock) ? qtyFmt(r.min_stock) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums"><MoneyDisplay amount={r.avg_cost} /></td>
                  <td className="px-3 py-2 text-right tabular-nums"><MoneyDisplay amount={r.value} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button type="button" className="rounded p-1 text-content-tertiary hover:bg-surface-secondary hover:text-content-primary" title={t('inventory.transfer', { defaultValue: 'Transfer' })} aria-label={t('inventory.transfer', { defaultValue: 'Transfer' })} onClick={() => onTransfer(r.item_id)}><ArrowLeftRight size={14} /></button>
                    <button type="button" className="rounded p-1 text-content-tertiary hover:bg-surface-secondary hover:text-content-primary" title={t('inventory.adjust', { defaultValue: 'Adjust stock' })} aria-label={t('inventory.adjust', { defaultValue: 'Adjust stock' })} onClick={() => onAdjust(r.item_id)}><SlidersHorizontal size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-content-tertiary">
          {stock.isLoading
            ? t('common.loading', { defaultValue: 'Loading…' })
            : lowOnly
              ? t('inventory.no_low', { defaultValue: 'Nothing is below its minimum stock.' })
              : t('inventory.no_stock_items', { defaultValue: 'No stock-tracked items yet. Mark goods as "Track stock" in Products & services.' })}
        </p>
      )}
    </div>
  );
}

function MovementsTab() {
  const { t } = useTranslation();
  const [f, setF] = useState({ warehouse_id: '', kind: '', q: '', date_from: '', date_to: '' });
  const [offset, setOffset] = useState(0);
  const warehouses = useQuery({ queryKey: ['inventory', 'warehouses'], queryFn: inventoryApi.warehouses });
  const moves = useQuery({
    queryKey: ['inventory', 'movements', f, offset],
    queryFn: () => inventoryApi.movements({ ...f, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  const set = (k: keyof typeof f, v: string) => { setOffset(0); setF((s) => ({ ...s, [k]: v })); };
  const total = moves.data?.total ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className={clsx(fieldCls, 'max-w-xs')} placeholder={t('inventory.search_moves', { defaultValue: 'SKU, name or document' })} value={f.q} onChange={(e) => set('q', e.target.value)} />
        <select className={clsx(fieldCls, 'w-auto')} value={f.warehouse_id} onChange={(e) => set('warehouse_id', e.target.value)} aria-label={t('inventory.col_warehouse', { defaultValue: 'Warehouse' })}>
          <option value="">{t('inventory.all_warehouses', { defaultValue: 'All warehouses' })}</option>
          {(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
        </select>
        <select className={clsx(fieldCls, 'w-auto')} value={f.kind} onChange={(e) => set('kind', e.target.value)} aria-label={t('inventory.col_kind', { defaultValue: 'Type' })}>
          <option value="">{t('inventory.all_kinds', { defaultValue: 'All types' })}</option>
          {MOVE_KINDS.map((k) => <option key={k} value={k}>{t(`inventory.kind_${k}`, { defaultValue: k.replace('_', ' ') })}</option>)}
        </select>
        <DateField className={clsx(fieldCls, 'w-auto')} value={f.date_from} onChange={(e) => set('date_from', e.target.value)} aria-label={t('inventory.date_from', { defaultValue: 'From' })} />
        <DateField className={clsx(fieldCls, 'w-auto')} value={f.date_to} onChange={(e) => set('date_to', e.target.value)} aria-label={t('inventory.date_to', { defaultValue: 'To' })} />
      </div>
      {moves.data?.items.length ? (
        <div className="rounded-lg border border-border-light">
          <MovementTable rows={moves.data.items} />
          <div className="flex items-center justify-between border-t border-border-light px-3 py-2 text-xs text-content-tertiary">
            <span>{t('inventory.showing', { defaultValue: '{{from}}–{{to}} of {{total}}', from: offset + 1, to: Math.min(offset + PAGE, total), total })}</span>
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t('common.previous', { defaultValue: 'Previous' })}</Button>
              <Button size="sm" variant="ghost" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>{t('common.next', { defaultValue: 'Next' })}</Button>
            </span>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-content-tertiary">
          {moves.isLoading ? t('common.loading', { defaultValue: 'Loading…' }) : t('inventory.no_moves', { defaultValue: 'No stock movements match these filters.' })}
        </p>
      )}
    </div>
  );
}

export function InventoryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>('stock');
  const [transferItem, setTransferItem] = useState<string | null>(null);
  const [adjustItem, setAdjustItem] = useState<string | null>(null);
  const summary = useQuery({ queryKey: ['inventory', 'summary'], queryFn: inventoryApi.summary });
  const s = summary.data;
  const tabs = useMemo(
    () => [
      { id: 'stock' as const, label: t('inventory.tab_stock', { defaultValue: 'Stock' }) },
      { id: 'movements' as const, label: t('inventory.tab_movements', { defaultValue: 'Movements' }) },
      { id: 'stocktakes' as const, label: t('inventory.tab_stocktakes', { defaultValue: 'Stocktakes' }) },
      { id: 'warehouses' as const, label: t('inventory.tab_warehouses', { defaultValue: 'Warehouses' }) },
    ],
    [t],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <PageHeader
        srTitle={t('inventory.title', { defaultValue: 'Inventory' })}
        subtitle={t('inventory.subtitle', { defaultValue: 'Stock on hand per warehouse, every movement behind it, transfers and stocktakes.' })}
        actions={
          <>
            <Button size="sm" variant="primary" icon={<ArrowLeftRight size={14} />} onClick={() => setTransferItem('')}>{t('inventory.transfer', { defaultValue: 'Transfer' })}</Button>
            <Button size="sm" variant="secondary" icon={<SlidersHorizontal size={14} />} onClick={() => setAdjustItem('')}>{t('inventory.adjust', { defaultValue: 'Adjust stock' })}</Button>
            <Button size="sm" variant="secondary" icon={<ClipboardList size={14} />} onClick={() => setTab('stocktakes')}>{t('inventory.stocktake', { defaultValue: 'Stocktake' })}</Button>
          </>
        }
      />
      <KpiBand
        columns={4}
        size="sm"
        items={[
          { key: 'value', label: t('inventory.kpi_value', { defaultValue: 'Stock value' }), value: s ? <MoneyDisplay amount={s.total_value} /> : '—' },
          { key: 'items', label: t('inventory.kpi_items', { defaultValue: 'Tracked items' }), value: s?.items ?? '—', sub: s ? t('inventory.kpi_warehouses', { defaultValue: '{{count}} warehouses', count: s.warehouses }) : undefined },
          { key: 'low', label: t('inventory.kpi_low', { defaultValue: 'Below minimum' }), value: s?.below_min ?? '—' },
          { key: 'out', label: t('inventory.kpi_out', { defaultValue: 'Out of stock' }), value: s?.out_of_stock ?? '—', sub: s ? t('inventory.kpi_reserved', { defaultValue: '{{count}} reserved on orders', count: s.reserved_items }) : undefined },
        ]}
      />
      <TabBar tabs={tabs} activeId={tab} onChange={setTab} ariaLabel={t('inventory.title', { defaultValue: 'Inventory' })} idPrefix="inventory" />
      <div role="tabpanel">
        {tab === 'stock' && <StockTab onTransfer={setTransferItem} onAdjust={setAdjustItem} />}
        {tab === 'movements' && <MovementsTab />}
        {tab === 'stocktakes' && <StocktakesTab />}
        {tab === 'warehouses' && <WarehousesTab />}
      </div>
      <TransferDrawer itemId={transferItem} onClose={() => setTransferItem(null)} />
      <AdjustDrawer itemId={adjustItem} onClose={() => setAdjustItem(null)} />
    </div>
  );
}
