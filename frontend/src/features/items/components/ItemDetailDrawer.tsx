import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Copy, Pencil, Power, Trash2 } from 'lucide-react';
import { Badge, Button, SideDrawer, TabBar } from '@/shared/ui';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { DateDisplay } from '@/shared/ui/DateDisplay';
import { TYPE_VARIANT, itemsApi, marginPct, type Item } from '../api';
import { stockLevel } from '../itemsLogic';
import { ItemThumb, MarginText, TYPE_LABEL } from './ItemBits';
import { fmtUpTo } from '@/shared/lib/formatters';

type TabId = 'overview' | 'prices' | 'sales' | 'purchases' | 'activity';

interface Props {
  item: Item | null;
  onHand?: string;
  categoryName?: string;
  onClose: () => void;
  onEdit: (item: Item) => void;
  onDuplicate: (item: Item) => void;
  onToggleActive: (item: Item) => void;
  onDelete: (item: Item) => void;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border-light bg-surface-primary px-3 py-2.5">
      <div className="text-xs text-content-tertiary">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-content-primary">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border-light py-2 text-sm last:border-0">
      <span className="text-content-tertiary">{label}</span>
      <span className="text-right text-content-primary">{children || '—'}</span>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-content-tertiary">{children}</p>;
}

const th = 'px-3 py-2 text-left font-medium';
const thR = 'px-3 py-2 text-right font-medium';
const qtyFmt = (v: string) => fmtUpTo(Number(v), 2);

export function ItemDetailDrawer({ item, onHand, categoryName, onClose, onEdit, onDuplicate, onToggleActive, onDelete }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>('overview');
  const id = item?.id ?? '';
  const breaks = useQuery({ queryKey: ['items', 'breaks', id], queryFn: () => itemsApi.priceBreaks(id), enabled: !!item && (tab === 'prices' || tab === 'overview'), retry: false });
  const sales = useQuery({ queryKey: ['items', 'sales', id], queryFn: () => itemsApi.salesHistory(id), enabled: !!item && tab !== 'prices', retry: false });
  const buys = useQuery({ queryKey: ['items', 'purchases', id], queryFn: () => itemsApi.purchases(id), enabled: !!item && tab !== 'prices', retry: false });

  if (!item) return null;
  const margin = marginPct(item.sales_price, item.purchase_cost);
  const level = stockLevel(item, onHand);
  const soldQty = (sales.data ?? []).filter((r) => r.kind === 'invoice').reduce((s, r) => s + Number(r.qty), 0);
  const revenue = (sales.data ?? []).filter((r) => r.kind === 'invoice').reduce((s, r) => s + Number(r.net), 0);

  const activity = [
    ...(item.created_at ? [{ date: item.created_at, text: t('items.act_created', { defaultValue: 'Item created' }) }] : []),
    ...(item.updated_at && item.updated_at !== item.created_at ? [{ date: item.updated_at, text: t('items.act_updated', { defaultValue: 'Item details last changed' }) }] : []),
    ...(sales.data ?? []).map((r) => ({
      date: r.doc_date,
      text: t('items.act_sold', { defaultValue: '{{qty}} on {{kind}} {{number}} for {{who}}', qty: qtyFmt(r.qty), kind: t(`items.kind_${r.kind}`, { defaultValue: r.kind }), number: r.number, who: r.customer_name || '—' }),
    })),
    ...(buys.data ?? []).map((r) => ({
      date: r.doc_date,
      text: t('items.act_bought', { defaultValue: '{{qty}} ordered on {{number}} from {{who}}', qty: qtyFmt(r.qty), number: r.number, who: r.supplier_name || '—' }),
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const tabs = [
    { id: 'overview' as const, label: t('items.tab_overview', { defaultValue: 'Overview' }) },
    { id: 'prices' as const, label: t('items.tab_prices', { defaultValue: 'Price lists' }), badge: breaks.data?.length || undefined },
    { id: 'sales' as const, label: t('items.tab_sales', { defaultValue: 'Sales' }), badge: sales.data?.length || undefined },
    { id: 'purchases' as const, label: t('items.tab_purchases', { defaultValue: 'Purchases' }), badge: buys.data?.length || undefined },
    { id: 'activity' as const, label: t('items.tab_activity', { defaultValue: 'Activity' }) },
  ];

  return (
    <SideDrawer
      open={!!item}
      onClose={onClose}
      widthClass="max-w-2xl"
      title={
        <span className="flex items-center gap-3">
          <ItemThumb item={item} size={36} />
          <span className="min-w-0">
            <span className="block truncate">{item.name}</span>
            <span className="block font-mono text-xs font-normal text-content-tertiary">{item.sku}</span>
          </span>
        </span>
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge size="sm" variant={TYPE_VARIANT[item.item_type]}>{t(`items.type_${item.item_type}`, { defaultValue: TYPE_LABEL[item.item_type] })}</Badge>
          {categoryName && <Badge size="sm" variant="neutral">{categoryName}</Badge>}
          <Badge size="sm" variant={item.active ? 'success' : 'neutral'}>
            {item.active ? t('items.status_active', { defaultValue: 'Active' }) : t('items.status_inactive', { defaultValue: 'Inactive' })}
          </Badge>
        </span>
      }
      headerActions={
        <Button size="sm" variant="primary" icon={<Pencil size={14} />} onClick={() => onEdit(item)}>
          {t('common.edit', { defaultValue: 'Edit' })}
        </Button>
      }
    >
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={() => onDuplicate(item)}>{t('items.duplicate', { defaultValue: 'Duplicate' })}</Button>
          <Button size="sm" variant="secondary" icon={<Power size={14} />} onClick={() => onToggleActive(item)}>
            {item.active ? t('items.deactivate', { defaultValue: 'Deactivate' }) : t('items.activate', { defaultValue: 'Activate' })}
          </Button>
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => onDelete(item)}>{t('common.delete', { defaultValue: 'Delete' })}</Button>
        </div>

        <TabBar tabs={tabs} activeId={tab} onChange={setTab} ariaLabel={t('items.detail_tabs', { defaultValue: 'Item details' })} idPrefix="item-detail" />

        {tab === 'overview' && (
          <div role="tabpanel" className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t('items.col_price', { defaultValue: 'Sales price' })}><MoneyDisplay amount={item.sales_price} currency={item.currency} /></Stat>
              <Stat label={t('items.col_cost', { defaultValue: 'Cost' })}><MoneyDisplay amount={item.purchase_cost} currency={item.currency} /></Stat>
              <Stat label={t('items.margin_label', { defaultValue: 'Margin' })}><MarginText pct={margin} /></Stat>
              <Stat label={t('items.col_stock', { defaultValue: 'In stock' })}>
                {level === 'none' ? <span className="text-content-tertiary">—</span> : (
                  <span className={level === 'ok' ? '' : level === 'low' ? 'text-semantic-warning' : 'text-semantic-error'}>
                    {qtyFmt(onHand ?? '0')} <span className="text-xs font-normal text-content-tertiary">{item.uom}</span>
                  </span>
                )}
              </Stat>
            </div>
            {level === 'low' || level === 'out' ? (
              <p className="rounded-lg bg-semantic-warning-bg px-3 py-2 text-sm text-semantic-warning">
                {t('items.reorder_hint', {
                  defaultValue: 'Stock is below the minimum of {{min}}. Suggested reorder: {{qty}} {{uom}}.',
                  min: qtyFmt(item.min_stock), qty: qtyFmt(String(Math.max(Number(item.reorder_qty) || 0, Number(item.min_stock) - Number(onHand ?? 0)))), uom: item.uom,
                })}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Stat label={t('items.sold_qty', { defaultValue: 'Invoiced quantity' })}>{qtyFmt(String(soldQty))} <span className="text-xs font-normal text-content-tertiary">{item.uom}</span></Stat>
              <Stat label={t('items.revenue', { defaultValue: 'Invoiced revenue' })}><MoneyDisplay amount={revenue} currency={item.currency} /></Stat>
            </div>
            <div className="rounded-lg border border-border-light px-3">
              <Row label={t('items.col_uom', { defaultValue: 'Unit' })}>{item.uom}</Row>
              <Row label={t('items.tax_code', { defaultValue: 'Tax code' })}>{item.tax_code}</Row>
              <Row label={t('items.barcode', { defaultValue: 'Barcode' })}>{item.barcode && <span className="font-mono">{item.barcode}</span>}</Row>
              <Row label={t('items.min_stock', { defaultValue: 'Minimum stock' })}>{item.stock_tracked ? qtyFmt(item.min_stock) : ''}</Row>
              <Row label={t('items.reorder_qty', { defaultValue: 'Reorder quantity' })}>{item.stock_tracked ? qtyFmt(item.reorder_qty) : ''}</Row>
              <Row label={t('items.revenue_account', { defaultValue: 'Revenue account' })}>{item.revenue_account}</Row>
              <Row label={t('items.expense_account', { defaultValue: 'Expense account' })}>{item.expense_account}</Row>
            </div>
            {item.description && <p className="whitespace-pre-line text-sm text-content-secondary">{item.description}</p>}
            {item.notes && (
              <div className="rounded-lg bg-surface-secondary px-3 py-2 text-sm text-content-secondary">
                <div className="mb-1 text-xs font-medium text-content-tertiary">{t('items.section_notes', { defaultValue: 'Notes' })}</div>
                <p className="whitespace-pre-line">{item.notes}</p>
              </div>
            )}
          </div>
        )}

        {tab === 'prices' && (
          <div role="tabpanel" className="space-y-3">
            {breaks.data?.length ? (
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary text-xs text-content-tertiary">
                  <tr><th className={th}>{t('items.price_list', { defaultValue: 'Price list' })}</th><th className={th}>{t('items.applies_to', { defaultValue: 'Applies to' })}</th><th className={thR}>{t('items.from_qty', { defaultValue: 'From qty' })}</th><th className={thR}>{t('items.unit_price', { defaultValue: 'Unit price' })}</th></tr>
                </thead>
                <tbody>
                  {breaks.data.map((b, i) => (
                    <tr key={i} className="border-t border-border-light">
                      <td className="px-3 py-2">{b.price_list_name}{!b.active && <span className="ml-1 text-xs text-content-tertiary">({t('items.status_inactive', { defaultValue: 'Inactive' })})</span>}</td>
                      <td className="px-3 py-2 text-content-secondary">{b.customer_id ? t('items.pl_one_customer', { defaultValue: 'One customer' }) : b.customer_group || t('items.pl_everyone', { defaultValue: 'All customers' })}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(b.min_qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums"><MoneyDisplay amount={b.unit_price} currency={b.currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{t('items.no_breaks', { defaultValue: 'This item sells at its standard price — no price list mentions it yet.' })}</Empty>
            )}
            <Link to="/items/price-lists" className="text-sm text-oe-blue hover:underline">{t('items.manage_price_lists', { defaultValue: 'Manage price lists' })} →</Link>
          </div>
        )}

        {tab === 'sales' && (
          <div role="tabpanel">
            {sales.data?.length ? (
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary text-xs text-content-tertiary">
                  <tr><th className={th}>{t('items.doc_date', { defaultValue: 'Date' })}</th><th className={th}>{t('items.document', { defaultValue: 'Document' })}</th><th className={th}>{t('items.customer', { defaultValue: 'Customer' })}</th><th className={thR}>{t('items.qty', { defaultValue: 'Quantity' })}</th><th className={thR}>{t('items.net', { defaultValue: 'Net' })}</th></tr>
                </thead>
                <tbody>
                  {sales.data.map((r, i) => (
                    <tr key={i} className="border-t border-border-light">
                      <td className="px-3 py-2"><DateDisplay value={r.doc_date} /></td>
                      <td className="px-3 py-2"><Link className="hover:underline" to={`/sales?doc=${r.document_id}`}>{t(`items.kind_${r.kind}`, { defaultValue: r.kind })} {r.number}</Link></td>
                      <td className="px-3 py-2 text-content-secondary">{r.customer_name || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(r.qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums"><MoneyDisplay amount={r.net} currency={r.currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{sales.isLoading ? t('common.loading', { defaultValue: 'Loading…' }) : t('items.no_sales', { defaultValue: 'Not sold yet. Quotes, orders and invoices with this SKU appear here.' })}</Empty>
            )}
          </div>
        )}

        {tab === 'purchases' && (
          <div role="tabpanel">
            {buys.data?.length ? (
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary text-xs text-content-tertiary">
                  <tr><th className={th}>{t('items.doc_date', { defaultValue: 'Date' })}</th><th className={th}>{t('items.order', { defaultValue: 'Order' })}</th><th className={th}>{t('items.supplier', { defaultValue: 'Supplier' })}</th><th className={thR}>{t('items.ordered_received', { defaultValue: 'Ordered / received' })}</th><th className={thR}>{t('items.unit_price', { defaultValue: 'Unit price' })}</th></tr>
                </thead>
                <tbody>
                  {buys.data.map((r, i) => (
                    <tr key={i} className="border-t border-border-light">
                      <td className="px-3 py-2"><DateDisplay value={r.doc_date} /></td>
                      <td className="px-3 py-2"><Link className="hover:underline" to={`/purchasing?order=${r.order_id}`}>{r.number}</Link></td>
                      <td className="px-3 py-2 text-content-secondary">{r.supplier_name || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(r.qty)} / {qtyFmt(r.qty_received)}</td>
                      <td className="px-3 py-2 text-right tabular-nums"><MoneyDisplay amount={r.unit_price} currency={r.currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{buys.isLoading ? t('common.loading', { defaultValue: 'Loading…' }) : t('items.no_purchases', { defaultValue: 'No purchase orders for this item yet.' })}</Empty>
            )}
          </div>
        )}

        {tab === 'activity' && (
          <div role="tabpanel">
            {activity.length ? (
              <ol className="relative space-y-3 border-l border-border-light pl-4">
                {activity.map((a, i) => (
                  <li key={i} className="text-sm">
                    <span className="absolute -left-1 mt-1.5 h-2 w-2 rounded-full bg-oe-blue" aria-hidden />
                    <div className="text-xs text-content-tertiary"><DateDisplay value={a.date} /></div>
                    <div className="text-content-primary">{a.text}</div>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>{t('items.no_activity', { defaultValue: 'Nothing has happened with this item yet.' })}</Empty>
            )}
          </div>
        )}
      </div>
    </SideDrawer>
  );
}
