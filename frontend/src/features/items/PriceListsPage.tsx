import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Calculator, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Breadcrumb, ConfirmDialog, ContactSearchInput } from '@/shared/ui';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { getErrorMessage } from '@/shared/lib/api';
import { PageHeader } from '@/shared/ui/PageHeader';
import { itemsApi, type PriceBreak, type PriceList, type PriceListInput, type PriceQuote } from './api';

const input =
  'h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';

const blank = (): PriceListInput => ({
  name: '',
  currency: 'EUR',
  customer_group: '',
  customer_id: null,
  valid_from: null,
  valid_to: null,
  priority: 0,
  active: true,
  items: [],
});

const toInput = (pl: PriceList): PriceListInput => ({
  name: pl.name,
  currency: pl.currency,
  customer_group: pl.customer_group,
  customer_id: pl.customer_id,
  valid_from: pl.valid_from,
  valid_to: pl.valid_to,
  priority: pl.priority,
  active: pl.active,
  items: pl.items.map(({ item_id, min_qty, unit_price }) => ({ item_id, min_qty: String(Number(min_qty)), unit_price: String(unit_price) })),
});

export function PriceListsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const lists = useQuery({ queryKey: ['items', 'price-lists'], queryFn: itemsApi.priceLists, retry: false });
  const items = useQuery({ queryKey: ['items', { active: true, limit: 500 }], queryFn: () => itemsApi.list({ active: true, limit: 500 }), retry: false });
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<PriceListInput>(blank());
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [pv, setPv] = useState({ item_id: '', customer_id: '', customer_group: '', qty: '1', on_date: '' });
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const itemById = new Map((items.data?.items ?? []).map((it) => [it.id, it]));

  const open = (pl: PriceList | null) => {
    setErr(null);
    setSelected(pl ? pl.id : 'new');
    setForm(pl ? toInput(pl) : blank());
  };
  const set = <K extends keyof PriceListInput>(k: K, v: PriceListInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setRow = (i: number, patch: Partial<PriceBreak>) =>
    setForm((f) => ({ ...f, items: f.items.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  const onError = (e: unknown) => setErr(e instanceof Error ? e.message : String(e));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        currency: form.currency.toUpperCase(),
        valid_from: form.valid_from || null,
        valid_to: form.valid_to || null,
        items: form.items.filter((r) => r.item_id).map((r) => ({ ...r, min_qty: r.min_qty || '0', unit_price: r.unit_price || '0' })),
      };
      return selected === 'new' ? itemsApi.createPriceList(body) : itemsApi.updatePriceList(selected!, body);
    },
    onSuccess: (pl) => {
      qc.invalidateQueries({ queryKey: ['items', 'price-lists'] });
      open(pl);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => itemsApi.removePriceList(selected!),
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: ['items', 'price-lists'] });
    },
    onError,
  });

  const preview = useMutation({
    mutationFn: () => itemsApi.resolvePrice({
      item_id: pv.item_id,
      qty: pv.qty.replace(',', '.') || '1',
      customer_id: pv.customer_id || undefined,
      customer_group: pv.customer_group || undefined,
      on_date: pv.on_date || undefined,
    }),
    onSuccess: (q) => { setQuote(q); setQuoteErr(null); },
    onError: (e) => { setQuote(null); setQuoteErr(getErrorMessage(e)); },
  });
  const quoteList = quote?.price_list_id ? lists.data?.find((l) => l.id === quote.price_list_id) : undefined;

  const audience = (pl: PriceList) =>
    pl.customer_id
      ? t('items.pl_one_customer', { defaultValue: 'One customer' })
      : pl.customer_group || t('items.pl_everyone', { defaultValue: 'All customers' });

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: t('items.title', { defaultValue: 'Products & services' }), to: '/items' },
          { label: t('items.price_lists', { defaultValue: 'Price lists' }) },
        ]}
      />
      <PageHeader
        srTitle={t('items.price_lists', { defaultValue: 'Price lists' })}
        subtitle={t('items.pl_subtitle', { defaultValue: 'Customer-specific and volume prices that override the standard item price.' })}
        actions={
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => open(null)}>
            {t('items.new_price_list', { defaultValue: 'New price list' })}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="rounded-md border border-border-light bg-surface-primary">
          {lists.isLoading && <p className="px-3 py-4 text-sm text-content-tertiary">{t('common.loading', { defaultValue: 'Loading…' })}</p>}
          {lists.error && <p className="px-3 py-4 text-sm text-content-secondary">{t('items.load_error', { defaultValue: "We couldn't load the item list right now." })}</p>}
          {lists.data?.length === 0 && (
            <div className="px-3 py-6 text-center">
              <p className="text-sm font-medium text-content-primary">{t('items.pl_empty_title', { defaultValue: 'No price lists yet' })}</p>
              <p className="mt-1 text-xs text-content-secondary">
                {t('items.pl_empty_hint', { defaultValue: 'Items sell at their standard price until a price list applies to the customer.' })}
              </p>
            </div>
          )}
          {lists.data?.map((pl) => (
            <button
              key={pl.id}
              type="button"
              onClick={() => open(pl)}
              className={clsx(
                'block w-full border-b border-border-light px-3 py-2 text-left last:border-b-0 hover:bg-surface-secondary',
                selected === pl.id && 'bg-surface-secondary',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-content-primary">{pl.name}</span>
                <span className="text-xs text-content-tertiary">{pl.currency}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-content-secondary">
                {audience(pl)}
                <span className="text-content-tertiary">· {t('items.pl_rows', { defaultValue: '{{n}} prices', n: pl.items.length })}</span>
                {pl.priority !== 0 && <span className="text-content-tertiary">· P{pl.priority}</span>}
                {!pl.active && <Badge size="sm" variant="neutral">{t('items.inactive', { defaultValue: 'inactive' })}</Badge>}
              </div>
            </button>
          ))}
        </div>

        {selected === null ? (
          <div className="rounded-md border border-dashed border-border-light px-4 py-10 text-center text-sm text-content-secondary">
            {t('items.pl_pick', { defaultValue: 'Select a price list or create a new one.' })}
          </div>
        ) : (
          <div className="rounded-md border border-border-light bg-surface-primary p-4">
            {err && <p className="mb-3 rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-semantic-error">{err}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-content-secondary">{t('items.col_name', { defaultValue: 'Name' })}</span>
                <input className={input} value={form.name} onChange={(e) => set('name', e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-content-secondary">{t('items.currency', { defaultValue: 'Currency' })}</span>
                <input className={`${input} uppercase`} maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-content-secondary">{t('items.customer_group', { defaultValue: 'Customer group' })}</span>
                <input
                  className={input}
                  placeholder={t('items.pl_everyone', { defaultValue: 'All customers' })}
                  value={form.customer_group}
                  onChange={(e) => set('customer_group', e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-content-secondary">{t('items.pl_customer', { defaultValue: 'One customer only' })}</span>
                <ContactSearchInput
                  value={form.customer_id ?? ''}
                  onChange={(id) => set('customer_id', id || null)}
                  placeholder={t('items.pl_customer_ph', { defaultValue: 'Any customer' })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-content-secondary">{t('items.valid_from', { defaultValue: 'Valid from' })}</span>
                <input type="date" className={input} value={form.valid_from ?? ''} onChange={(e) => set('valid_from', e.target.value || null)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-content-secondary">{t('items.valid_to', { defaultValue: 'Valid to' })}</span>
                <input type="date" className={input} value={form.valid_to ?? ''} onChange={(e) => set('valid_to', e.target.value || null)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-content-secondary">{t('items.priority', { defaultValue: 'Priority' })}</span>
                <input type="number" className={input} value={form.priority} onChange={(e) => set('priority', Number(e.target.value) || 0)} />
              </label>
              <label className="flex items-center gap-2 self-end pb-1 text-sm text-content-primary">
                <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
                {t('items.active', { defaultValue: 'Active' })}
              </label>
            </div>

            <h2 className="mb-2 mt-5 text-sm font-semibold text-content-primary">{t('items.pl_prices', { defaultValue: 'Prices and quantity breaks' })}</h2>
            <div className="overflow-x-auto rounded border border-border-light">
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-content-tertiary">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">{t('items.item', { defaultValue: 'Item' })}</th>
                    <th className="w-28 px-2 py-1.5 text-right font-medium">{t('items.min_qty', { defaultValue: 'From qty' })}</th>
                    <th className="w-32 px-2 py-1.5 text-right font-medium">{t('items.unit_price', { defaultValue: 'Unit price' })}</th>
                    <th className="w-28 px-2 py-1.5 text-right font-medium">{t('items.vs_standard', { defaultValue: 'vs standard' })}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {form.items.length === 0 && (
                    <tr><td colSpan={5} className="px-2 py-4 text-center text-xs text-content-tertiary">{t('items.pl_no_rows', { defaultValue: 'No prices yet. Add a row per item and quantity break.' })}</td></tr>
                  )}
                  {form.items.map((r, i) => (
                    <tr key={i} className="border-t border-border-light">
                      <td className="px-2 py-1">
                        <select className={input} value={r.item_id} onChange={(e) => setRow(i, { item_id: e.target.value })}>
                          <option value="">{t('items.choose_item', { defaultValue: 'Choose an item…' })}</option>
                          {items.data?.items.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <input className={`${input} text-right`} inputMode="decimal" value={r.min_qty} onChange={(e) => setRow(i, { min_qty: e.target.value })} />
                      </td>
                      <td className="px-2 py-1">
                        <input className={`${input} text-right`} inputMode="decimal" value={r.unit_price} onChange={(e) => setRow(i, { unit_price: e.target.value })} />
                      </td>
                      <td className="px-2 py-1 text-right text-xs tabular-nums">
                        <VsStandard std={itemById.get(r.item_id)?.sales_price} price={r.unit_price} />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button
                          type="button"
                          aria-label={t('common.delete', { defaultValue: 'Delete' })}
                          className="text-content-tertiary hover:text-content-primary"
                          onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => set('items', [...form.items, { item_id: '', min_qty: '0', unit_price: '' }])}>
                {t('items.add_price', { defaultValue: 'Add price' })}
              </Button>
              <div className="flex gap-2">
                {selected !== 'new' && (
                  <Button size="sm" variant="secondary" disabled={remove.isPending} onClick={() => setConfirmDel(true)}>
                    {t('common.delete', { defaultValue: 'Delete' })}
                  </Button>
                )}
                <Button variant="primary" size="sm" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
                  {t('common.save', { defaultValue: 'Save' })}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <section className="rounded-md border border-border-light bg-surface-primary p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-content-primary">
          <Calculator size={15} className="text-content-tertiary" />
          {t('items.pl_preview', { defaultValue: 'Price preview' })}
        </h2>
        <p className="mb-3 mt-0.5 text-xs text-content-tertiary">
          {t('items.pl_preview_hint', { defaultValue: 'Check which price a customer would get for an item and quantity after all price lists and discounts.' })}
        </p>
        <form
          className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_6rem_9rem_auto]"
          onSubmit={(e) => { e.preventDefault(); if (pv.item_id) preview.mutate(); }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-content-secondary">{t('items.item', { defaultValue: 'Item' })}</span>
            <select className={input} value={pv.item_id} onChange={(e) => setPv({ ...pv, item_id: e.target.value })}>
              <option value="">{t('items.choose_item', { defaultValue: 'Choose an item…' })}</option>
              {items.data?.items.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-content-secondary">{t('items.customer', { defaultValue: 'Customer' })}</span>
            <ContactSearchInput value={pv.customer_id} onChange={(id) => setPv({ ...pv, customer_id: id })} placeholder={t('items.pl_customer_ph', { defaultValue: 'Any customer' })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-content-secondary">{t('items.customer_group', { defaultValue: 'Customer group' })}</span>
            <input className={input} value={pv.customer_group} onChange={(e) => setPv({ ...pv, customer_group: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-content-secondary">{t('items.qty', { defaultValue: 'Quantity' })}</span>
            <input className={`${input} text-right`} inputMode="decimal" value={pv.qty} onChange={(e) => setPv({ ...pv, qty: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-content-secondary">{t('items.on_date', { defaultValue: 'On date' })}</span>
            <input type="date" className={input} value={pv.on_date} onChange={(e) => setPv({ ...pv, on_date: e.target.value })} />
          </label>
          <Button type="submit" size="sm" variant="primary" disabled={!pv.item_id || preview.isPending}>
            {t('items.calculate', { defaultValue: 'Calculate' })}
          </Button>
        </form>
        {quoteErr && <p className="mt-3 text-sm text-semantic-error">{quoteErr}</p>}
        {quote && (
          <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg bg-surface-secondary px-3 py-2.5 text-sm">
            <span className="text-lg font-semibold tabular-nums text-content-primary"><MoneyDisplay amount={quote.unit_price} currency={quote.currency} /></span>
            <span className="text-content-secondary">
              {t('items.list_price', { defaultValue: 'List price' })}: <MoneyDisplay amount={quote.list_price} currency={quote.currency} />
            </span>
            {Number(quote.discount_pct) > 0 && (
              <span className="text-semantic-success">-{Number(quote.discount_pct)}% {t('items.discount', { defaultValue: 'discount' })}</span>
            )}
            <span className="text-content-tertiary">
              {quote.source === 'price_list'
                ? t('items.from_list_named', { defaultValue: 'from price list "{{name}}"', name: quoteList?.name ?? '' })
                : t('items.from_item', { defaultValue: 'standard price' })}
            </span>
            <span className="text-content-tertiary">
              {t('items.line_total', { defaultValue: 'Line total' })}: <MoneyDisplay amount={Number(quote.unit_price) * Number(quote.qty)} currency={quote.currency} />
            </span>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmDel}
        title={t('items.pl_delete_title', { defaultValue: 'Delete this price list?' })}
        message={t('items.pl_delete_body', { defaultValue: 'Customers fall back to the next matching list or the standard price.' })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        loading={remove.isPending}
        onCancel={() => setConfirmDel(false)}
        onConfirm={() => { setConfirmDel(false); remove.mutate(); }}
      />
    </div>
  );
}

/** Difference of a list price to the item's standard price, in %. */
function VsStandard({ std, price }: { std: string | undefined; price: string }) {
  const s = Number(std ?? 0);
  const p = Number(String(price).replace(',', '.'));
  if (!s || !price || !Number.isFinite(p)) return <span className="text-content-tertiary">—</span>;
  const d = Math.round(((p - s) / s) * 1000) / 10;
  return <span className={d < 0 ? 'text-semantic-success' : d > 0 ? 'text-semantic-warning' : 'text-content-tertiary'}>{d > 0 ? '+' : ''}{d}%</span>;
}
