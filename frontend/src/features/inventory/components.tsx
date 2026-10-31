import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Plus, Star } from 'lucide-react';
import { Badge, Button, ConfirmDialog, SideDrawer } from '@/shared/ui';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { DateDisplay } from '@/shared/ui/DateDisplay';
import { getErrorMessage } from '@/shared/lib/api';
import { fmtUpTo } from '@/shared/lib/formatters';
import { inventoryApi, type Stocktake } from './api';

export const fieldCls =
  'h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';
const qtyFmt = (v: string | number) => fmtUpTo(Number(v), 2);
const today = () => new Date().toISOString().slice(0, 10);

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['inventory'] });
    void qc.invalidateQueries({ queryKey: ['items'] });
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-content-secondary">{label}</span>
      {children}
    </label>
  );
}

function ErrorLine({ msg }: { msg: string | null }) {
  return msg ? <p role="alert" className="rounded-lg bg-semantic-error-bg px-3 py-2 text-sm text-semantic-error">{msg}</p> : null;
}

function useTrackedItems(enabled: boolean) {
  return useQuery({ queryKey: ['inventory', 'stock', 'picker'], queryFn: () => inventoryApi.stock(), enabled });
}

/** itemId: null = closed, '' = open without a preselected item. */
export function TransferDrawer({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const open = itemId !== null;
  const items = useTrackedItems(open);
  const warehouses = useQuery({ queryKey: ['inventory', 'warehouses'], queryFn: inventoryApi.warehouses, enabled: open });
  const whs = (warehouses.data ?? []).filter((w) => w.active);
  const [f, setF] = useState({ item_id: '', from: '', to: '', qty: '', move_date: today(), notes: '' });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setF((s) => ({ ...s, item_id: itemId || '', qty: '', notes: '' })); setErr(null); }
  }, [open, itemId]);
  useEffect(() => {
    if (whs.length && !f.from) setF((s) => ({ ...s, from: whs[0]!.id, to: whs[1]?.id ?? '' }));
  }, [whs, f.from]);
  const row = items.data?.find((r) => r.item_id === f.item_id);
  const save = useMutation({
    mutationFn: () => inventoryApi.transfer({ item_id: f.item_id, from_warehouse_id: f.from, to_warehouse_id: f.to, qty: f.qty, move_date: f.move_date, notes: f.notes }),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (e) => setErr(getErrorMessage(e)),
  });
  const valid = f.item_id && f.from && f.to && f.from !== f.to && Number(f.qty) > 0;

  return (
    <SideDrawer open={open} onClose={onClose} title={t('inventory.transfer_title', { defaultValue: 'Transfer stock' })}>
      <form className="space-y-3 p-4 sm:p-5" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
        {whs.length < 2 && <p className="rounded-lg bg-surface-secondary px-3 py-2 text-sm text-content-secondary">{t('inventory.need_two_warehouses', { defaultValue: 'Add a second warehouse first (Warehouses tab).' })}</p>}
        <Field label={t('inventory.col_item', { defaultValue: 'Item' })}>
          <select className={fieldCls} value={f.item_id} onChange={(e) => setF({ ...f, item_id: e.target.value })} required>
            <option value="">—</option>
            {(items.data ?? []).map((r) => <option key={r.item_id} value={r.item_id}>{r.sku} · {r.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('inventory.from_warehouse', { defaultValue: 'From' })}>
            <select className={fieldCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>
              {whs.map((w) => <option key={w.id} value={w.id}>{w.code}{row ? ` (${qtyFmt(row.by_warehouse[w.id] ?? '0')})` : ''}</option>)}
            </select>
          </Field>
          <Field label={t('inventory.to_warehouse', { defaultValue: 'To' })}>
            <select className={fieldCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
              <option value="">—</option>
              {whs.filter((w) => w.id !== f.from).map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
            </select>
          </Field>
          <Field label={t('inventory.col_qty', { defaultValue: 'Quantity' })}>
            <input className={fieldCls} type="number" min="0" step="any" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required />
          </Field>
          <Field label={t('inventory.col_date', { defaultValue: 'Date' })}>
            <input className={fieldCls} type="date" value={f.move_date} onChange={(e) => setF({ ...f, move_date: e.target.value })} />
          </Field>
        </div>
        <Field label={t('inventory.notes', { defaultValue: 'Notes' })}>
          <input className={fieldCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <ErrorLine msg={err} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button type="submit" variant="primary" disabled={!valid} loading={save.isPending}>{t('inventory.transfer', { defaultValue: 'Transfer' })}</Button>
        </div>
      </form>
    </SideDrawer>
  );
}

export function AdjustDrawer({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const open = itemId !== null;
  const items = useTrackedItems(open);
  const warehouses = useQuery({ queryKey: ['inventory', 'warehouses'], queryFn: inventoryApi.warehouses, enabled: open });
  const whs = (warehouses.data ?? []).filter((w) => w.active);
  const [f, setF] = useState({ item_id: '', warehouse_id: '', kind: 'adjustment' as 'adjustment' | 'opening', qty: '', unit_cost: '', move_date: today(), notes: '' });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setF((s) => ({ ...s, item_id: itemId || '', qty: '', unit_cost: '', notes: '' })); setErr(null); }
  }, [open, itemId]);
  const save = useMutation({
    mutationFn: () =>
      inventoryApi.adjust({
        item_id: f.item_id,
        warehouse_id: f.warehouse_id || undefined,
        kind: f.kind,
        qty: f.qty,
        unit_cost: f.unit_cost || undefined,
        move_date: f.move_date,
        notes: f.notes,
      }),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (e) => setErr(getErrorMessage(e)),
  });
  const q = Number(f.qty);
  const valid = f.item_id && q !== 0 && !Number.isNaN(q) && (f.kind === 'adjustment' || (q > 0 && f.unit_cost !== ''));

  return (
    <SideDrawer open={open} onClose={onClose} title={t('inventory.adjust_title', { defaultValue: 'Adjust stock' })}>
      <form className="space-y-3 p-4 sm:p-5" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
        <div className="flex gap-2">
          {(['adjustment', 'opening'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setF({ ...f, kind: k })}
              className={clsx('rounded-lg border px-3 py-1.5 text-sm', f.kind === k ? 'border-oe-blue bg-oe-blue/10 text-oe-blue' : 'border-border text-content-secondary')}>
              {t(`inventory.kind_${k}`, { defaultValue: k })}
            </button>
          ))}
        </div>
        <p className="text-xs text-content-tertiary">
          {f.kind === 'adjustment'
            ? t('inventory.adjust_hint', { defaultValue: 'Positive adds, negative removes. Valued at the moving average cost and posted against the inventory-difference account.' })
            : t('inventory.opening_hint', { defaultValue: 'Initial quantity at a known unit cost. No journal entry: book the opening balance in the ledger separately.' })}
        </p>
        <Field label={t('inventory.col_item', { defaultValue: 'Item' })}>
          <select className={fieldCls} value={f.item_id} onChange={(e) => setF({ ...f, item_id: e.target.value })} required>
            <option value="">—</option>
            {(items.data ?? []).map((r) => <option key={r.item_id} value={r.item_id}>{r.sku} · {r.name} ({qtyFmt(r.on_hand)} {r.uom})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('inventory.col_warehouse', { defaultValue: 'Warehouse' })}>
            <select className={fieldCls} value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
              <option value="">{t('inventory.default_warehouse', { defaultValue: 'Default warehouse' })}</option>
              {whs.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </Field>
          <Field label={t('inventory.col_date', { defaultValue: 'Date' })}>
            <input className={fieldCls} type="date" value={f.move_date} onChange={(e) => setF({ ...f, move_date: e.target.value })} />
          </Field>
          <Field label={t('inventory.col_qty', { defaultValue: 'Quantity' })}>
            <input className={fieldCls} type="number" step="any" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required />
          </Field>
          <Field label={t('inventory.col_unit_cost', { defaultValue: 'Unit cost' })}>
            <input className={fieldCls} type="number" min="0" step="any" value={f.unit_cost} placeholder={f.kind === 'adjustment' ? t('inventory.avg_cost', { defaultValue: 'Avg. cost' }) : ''} onChange={(e) => setF({ ...f, unit_cost: e.target.value })} />
          </Field>
        </div>
        <Field label={t('inventory.notes', { defaultValue: 'Notes' })}>
          <input className={fieldCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <ErrorLine msg={err} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button type="submit" variant="primary" disabled={!valid} loading={save.isPending}>{t('common.save', { defaultValue: 'Save' })}</Button>
        </div>
      </form>
    </SideDrawer>
  );
}

export function WarehousesTab() {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const warehouses = useQuery({ queryKey: ['inventory', 'warehouses'], queryFn: inventoryApi.warehouses });
  const settings = useQuery({ queryKey: ['inventory', 'settings'], queryFn: inventoryApi.settings });
  const [f, setF] = useState({ code: '', name: '', address: '' });
  const [err, setErr] = useState<string | null>(null);
  const onError = (e: unknown) => setErr(getErrorMessage(e));
  const create = useMutation({
    mutationFn: () => inventoryApi.createWarehouse(f),
    onSuccess: () => { setF({ code: '', name: '', address: '' }); setErr(null); invalidate(); },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof inventoryApi.updateWarehouse>[1] }) => inventoryApi.updateWarehouse(id, body),
    onSuccess: () => { setErr(null); invalidate(); },
    onError,
  });
  const saveSettings = useMutation({ mutationFn: inventoryApi.saveSettings, onSuccess: invalidate, onError });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-2 lg:col-span-2">
        <ErrorLine msg={err} />
        <div className="overflow-x-auto rounded-lg border border-border-light">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-xs text-content-tertiary">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('inventory.wh_code', { defaultValue: 'Code' })}</th>
                <th className="px-3 py-2 text-left font-medium">{t('inventory.wh_name', { defaultValue: 'Name' })}</th>
                <th className="px-3 py-2 text-left font-medium">{t('inventory.wh_address', { defaultValue: 'Address' })}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(warehouses.data ?? []).map((w) => (
                <tr key={w.id} className={clsx('border-t border-border-light', !w.active && 'text-content-tertiary')}>
                  <td className="px-3 py-2 font-mono">{w.code}</td>
                  <td className="px-3 py-2">
                    {w.name}
                    {w.is_default && <Badge size="sm" variant="blue" className="ml-2">{t('inventory.default', { defaultValue: 'Default' })}</Badge>}
                    {!w.active && <Badge size="sm" variant="neutral" className="ml-2">{t('inventory.inactive', { defaultValue: 'Inactive' })}</Badge>}
                  </td>
                  <td className="px-3 py-2 text-content-secondary">{w.address || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {!w.is_default && w.active && (
                      <Button size="sm" variant="ghost" icon={<Star size={14} />} onClick={() => update.mutate({ id: w.id, body: { is_default: true } })}>{t('inventory.make_default', { defaultValue: 'Make default' })}</Button>
                    )}
                    {!w.is_default && (
                      <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: w.id, body: { active: !w.active } })}>
                        {w.active ? t('inventory.deactivate', { defaultValue: 'Deactivate' }) : t('inventory.activate', { defaultValue: 'Activate' })}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="space-y-4">
        <form className="space-y-3 rounded-lg border border-border-light p-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <h3 className="text-sm font-semibold">{t('inventory.new_warehouse', { defaultValue: 'New warehouse' })}</h3>
          <div className="grid grid-cols-3 gap-2">
            <input className={fieldCls} placeholder={t('inventory.wh_code', { defaultValue: 'Code' })} maxLength={32} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required />
            <input className={clsx(fieldCls, 'col-span-2')} placeholder={t('inventory.wh_name', { defaultValue: 'Name' })} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </div>
          <input className={fieldCls} placeholder={t('inventory.wh_address', { defaultValue: 'Address' })} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          <Button type="submit" size="sm" variant="primary" icon={<Plus size={14} />} loading={create.isPending} disabled={!f.code || !f.name}>{t('common.add', { defaultValue: 'Add' })}</Button>
        </form>
        {settings.data && (
          <div className="space-y-2 rounded-lg border border-border-light p-4 text-sm">
            <h3 className="font-semibold">{t('inventory.settings', { defaultValue: 'Stock rules' })}</h3>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={settings.data.allow_negative} onChange={(e) => saveSettings.mutate({ allow_negative: e.target.checked })} />
              <span>
                {t('inventory.allow_negative', { defaultValue: 'Allow negative stock' })}
                <span className="block text-xs text-content-tertiary">{t('inventory.allow_negative_hint', { defaultValue: 'When off, deliveries and transfers that exceed the quantity on hand are refused.' })}</span>
              </span>
            </label>
            <p className="text-xs text-content-tertiary">
              {t('inventory.accounts_hint', {
                defaultValue: 'Valuation: moving average. Accounts — inventory {{inv}}, cost of goods sold {{cogs}}, stock differences {{diff}}.',
                inv: settings.data.effective.inventory ?? '—',
                cogs: settings.data.effective.cogs ?? '—',
                diff: settings.data.effective.diff ?? '—',
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StocktakeSheet({ st, warehouseName, onClose }: { st: Stocktake; warehouseName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'post' | 'cancel' | 'delete' | null>(null);
  useEffect(() => {
    setCounts(Object.fromEntries(st.lines.map((l) => [l.id, l.counted_qty === null ? '' : String(Number(l.counted_qty))])));
    setErr(null);
  }, [st]);
  const draft = st.status === 'draft';
  const payload = () => st.lines.map((l) => ({ line_id: l.id, counted_qty: counts[l.id] === '' || counts[l.id] === undefined ? null : counts[l.id]! }));
  const onError = (e: unknown) => setErr(getErrorMessage(e));
  const save = useMutation({ mutationFn: () => inventoryApi.saveCounts(st.id, payload()), onSuccess: invalidate, onError });
  const post = useMutation({
    mutationFn: async () => { await inventoryApi.saveCounts(st.id, payload()); return inventoryApi.postStocktake(st.id); },
    onSuccess: () => { setConfirm(null); invalidate(); },
    onError: (e) => { setConfirm(null); onError(e); },
  });
  const cancel = useMutation({ mutationFn: () => inventoryApi.cancelStocktake(st.id), onSuccess: () => { setConfirm(null); invalidate(); }, onError });
  const del = useMutation({ mutationFn: () => inventoryApi.deleteStocktake(st.id), onSuccess: () => { setConfirm(null); invalidate(); onClose(); }, onError });
  const counted = st.lines.filter((l) => (counts[l.id] ?? '') !== '').length;

  return (
    <SideDrawer
      open
      onClose={onClose}
      widthClass="max-w-3xl"
      title={`${st.number} · ${warehouseName}`}
      subtitle={<span className="flex items-center gap-2"><DateDisplay value={st.count_date} /><StatusBadge status={st.status} /></span>}
    >
      <div className="space-y-3 p-4 sm:p-5">
        {draft && <p className="text-xs text-content-tertiary">{t('inventory.count_hint', { defaultValue: 'Enter what is physically on the shelf. Blank lines are skipped. Posting books the difference to the live quantity as adjustments.' })}</p>}
        <div className="overflow-x-auto rounded-lg border border-border-light">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-xs text-content-tertiary">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('inventory.col_item', { defaultValue: 'Item' })}</th>
                <th className="px-3 py-2 text-right font-medium">{t('inventory.expected', { defaultValue: 'Expected' })}</th>
                <th className="px-3 py-2 text-right font-medium">{t('inventory.counted', { defaultValue: 'Counted' })}</th>
                <th className="px-3 py-2 text-right font-medium">{t('inventory.difference', { defaultValue: 'Difference' })}</th>
                {!draft && <th className="px-3 py-2 text-right font-medium">{t('inventory.col_value', { defaultValue: 'Value' })}</th>}
              </tr>
            </thead>
            <tbody>
              {st.lines.map((l) => {
                const c = counts[l.id] ?? '';
                const diff = draft ? (c === '' ? null : Number(c) - Number(l.expected_qty)) : l.counted_qty === null ? null : Number(l.diff_qty);
                return (
                  <tr key={l.id} className="border-t border-border-light">
                    <td className="px-3 py-1.5"><span className="font-mono text-xs text-content-tertiary">{l.sku}</span> {l.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{qtyFmt(l.expected_qty)} <span className="text-xs text-content-tertiary">{l.uom}</span></td>
                    <td className="px-3 py-1.5 text-right">
                      {draft ? (
                        <input aria-label={`${t('inventory.counted', { defaultValue: 'Counted' })} ${l.sku}`} className={clsx(fieldCls, 'h-8 w-24 text-right')} type="number" min="0" step="any" value={c} onChange={(e) => setCounts({ ...counts, [l.id]: e.target.value })} />
                      ) : l.counted_qty === null ? '—' : qtyFmt(l.counted_qty)}
                    </td>
                    <td className={clsx('px-3 py-1.5 text-right tabular-nums', diff && diff < 0 && 'text-semantic-error', diff && diff > 0 && 'text-semantic-success')}>
                      {diff === null ? '—' : `${diff > 0 ? '+' : ''}${qtyFmt(diff)}`}
                    </td>
                    {!draft && <td className="px-3 py-1.5 text-right tabular-nums"><MoneyDisplay amount={l.diff_value} /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!draft && (
          <p className="text-sm">{t('inventory.net_difference', { defaultValue: 'Net difference' })}: <strong><MoneyDisplay amount={st.diff_value} /></strong></p>
        )}
        <ErrorLine msg={err} />
        <div className="flex flex-wrap justify-end gap-2">
          {draft && <Button variant="ghost" onClick={() => setConfirm('delete')}>{t('common.delete', { defaultValue: 'Delete' })}</Button>}
          {st.status === 'posted' && <Button variant="ghost" onClick={() => setConfirm('cancel')}>{t('inventory.cancel_stocktake', { defaultValue: 'Cancel and reverse' })}</Button>}
          {draft && <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>{t('inventory.save_counts', { defaultValue: 'Save counts' })}</Button>}
          {draft && <Button variant="primary" disabled={!counted} onClick={() => setConfirm('post')}>{t('inventory.post_stocktake', { defaultValue: 'Post differences' })}</Button>}
        </div>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        variant={confirm === 'post' ? 'warning' : 'danger'}
        loading={post.isPending || cancel.isPending || del.isPending}
        title={confirm === 'post' ? t('inventory.post_stocktake', { defaultValue: 'Post differences' }) : confirm === 'cancel' ? t('inventory.cancel_stocktake', { defaultValue: 'Cancel and reverse' }) : t('common.delete', { defaultValue: 'Delete' })}
        message={
          confirm === 'post'
            ? t('inventory.post_confirm', { defaultValue: '{{count}} counted lines will be booked as stock adjustments with a journal entry.', count: counted })
            : confirm === 'cancel'
              ? t('inventory.cancel_confirm', { defaultValue: 'The adjustments and the journal entry of this stocktake will be reversed.' })
              : t('inventory.delete_confirm', { defaultValue: 'Delete this draft count sheet?' })
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => (confirm === 'post' ? post.mutate() : confirm === 'cancel' ? cancel.mutate() : del.mutate())}
      />
    </SideDrawer>
  );
}

function StatusBadge({ status }: { status: Stocktake['status'] }) {
  const { t } = useTranslation();
  const variant = status === 'posted' ? 'success' : status === 'cancelled' ? 'neutral' : 'warning';
  return <Badge size="sm" variant={variant}>{t(`inventory.st_${status}`, { defaultValue: status })}</Badge>;
}

export function StocktakesTab() {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const list = useQuery({ queryKey: ['inventory', 'stocktakes'], queryFn: inventoryApi.stocktakes });
  const warehouses = useQuery({ queryKey: ['inventory', 'warehouses'], queryFn: inventoryApi.warehouses });
  const whs = (warehouses.data ?? []).filter((w) => w.active);
  const whName = (id: string) => warehouses.data?.find((w) => w.id === id)?.name ?? '';
  const [wh, setWh] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => inventoryApi.createStocktake({ warehouse_id: wh || undefined, count_date: today() }),
    onSuccess: (st) => { setErr(null); invalidate(); setOpenId(st.id); },
    onError: (e) => setErr(getErrorMessage(e)),
  });
  const current = list.data?.find((s) => s.id === openId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={clsx(fieldCls, 'w-auto')} value={wh} onChange={(e) => setWh(e.target.value)} aria-label={t('inventory.col_warehouse', { defaultValue: 'Warehouse' })}>
          <option value="">{t('inventory.default_warehouse', { defaultValue: 'Default warehouse' })}</option>
          {whs.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
        </select>
        <Button size="sm" variant="primary" icon={<Plus size={14} />} loading={create.isPending} onClick={() => create.mutate()}>{t('inventory.new_stocktake', { defaultValue: 'New count sheet' })}</Button>
      </div>
      <ErrorLine msg={err} />
      {list.data?.length ? (
        <div className="overflow-x-auto rounded-lg border border-border-light">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-xs text-content-tertiary">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('inventory.st_number', { defaultValue: 'Number' })}</th>
                <th className="px-3 py-2 text-left font-medium">{t('inventory.col_date', { defaultValue: 'Date' })}</th>
                <th className="px-3 py-2 text-left font-medium">{t('inventory.col_warehouse', { defaultValue: 'Warehouse' })}</th>
                <th className="px-3 py-2 text-left font-medium">{t('inventory.st_status', { defaultValue: 'Status' })}</th>
                <th className="px-3 py-2 text-right font-medium">{t('inventory.st_lines', { defaultValue: 'Counted' })}</th>
                <th className="px-3 py-2 text-right font-medium">{t('inventory.net_difference', { defaultValue: 'Net difference' })}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id} className="cursor-pointer border-t border-border-light hover:bg-surface-secondary" onClick={() => setOpenId(s.id)}>
                  <td className="px-3 py-2 font-mono">{s.number}</td>
                  <td className="px-3 py-2"><DateDisplay value={s.count_date} /></td>
                  <td className="px-3 py-2">{whName(s.warehouse_id)}</td>
                  <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.lines.filter((l) => l.counted_qty !== null).length} / {s.lines.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.status === 'draft' ? '—' : <MoneyDisplay amount={s.diff_value} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-content-tertiary">
          {list.isLoading ? t('common.loading', { defaultValue: 'Loading…' }) : t('inventory.no_stocktakes', { defaultValue: 'No stocktakes yet. Create a count sheet, enter what you find on the shelves and post the differences.' })}
        </p>
      )}
      {current && <StocktakeSheet st={current} warehouseName={whName(current.warehouse_id)} onClose={() => setOpenId(null)} />}
    </div>
  );
}
