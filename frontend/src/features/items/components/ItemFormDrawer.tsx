import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Calculator, Copy, Save } from 'lucide-react';
import { Button, ConfirmDialog, ContactSearchInput, SideDrawer } from '@/shared/ui';
import { apiGet, getErrorMessage } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { EMPTY_ITEM, ITEM_TYPES, itemsApi, marginPct, type Item, type ItemInput } from '../api';
import { isDirty, normaliseItem, priceForMargin, toInput, validateItem } from '../itemsLogic';
import { Field, MarginText, Section, TYPE_LABEL, control } from './ItemBits';
import { fmtFixed } from '@/shared/lib/formatters';

interface Props {
  open: boolean;
  /** Item to edit; null creates a new one (optionally pre-filled from ``seed``). */
  item: Item | null;
  seed?: Partial<ItemInput>;
  onClose: () => void;
  onSaved: (item: Item) => void;
}

export function ItemFormDrawer({ open, item, seed, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const isNew = !item;
  const cats = useQuery({ queryKey: ['items', 'categories'], queryFn: itemsApi.categories, enabled: open, retry: false });
  const settings = useQuery({
    queryKey: ['business-settings'],
    queryFn: () => apiGet<{ base_currency?: string | null }>('/v1/business-settings/'),
    enabled: open && isNew,
    retry: false,
  });

  const initial = useMemo<ItemInput>(
    () => (item ? toInput(item, EMPTY_ITEM) : { ...EMPTY_ITEM, ...seed }),
    [item, seed],
  );
  const [form, setForm] = useState<ItemInput>(initial);
  const [touched, setTouched] = useState(false);
  const [targetMargin, setTargetMargin] = useState('');
  const [newCat, setNewCat] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initial);
      setTouched(false);
      setServerErr(null);
      setTargetMargin('');
    }
  }, [open, initial]);
  useEffect(() => {
    const cur = settings.data?.base_currency;
    if (isNew && cur && !seed?.currency) setForm((f) => (isDirty(f, initial) ? f : { ...f, currency: cur }));
  }, [isNew, settings.data, seed, initial]);

  const set = <K extends keyof ItemInput>(k: K, v: ItemInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const errors = validateItem(form);
  const err = (k: keyof ItemInput) => (touched && errors[k] ? t(errors[k]!, { defaultValue: 'Check this value' }) : undefined);
  const dirty = isDirty(form, initial);
  const margin = marginPct(form.sales_price.replace(',', '.'), form.purchase_cost.replace(',', '.'));
  const profit = (Number(form.sales_price.replace(',', '.')) || 0) - (Number(form.purchase_cost.replace(',', '.')) || 0);

  const save = useMutation({
    mutationFn: () => {
      const body = normaliseItem(form);
      return isNew ? itemsApi.create(body) : itemsApi.update(item!.id, body);
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['items'] });
      addToast({ type: 'success', title: isNew
        ? t('items.toast_created', { defaultValue: '{{name}} added to the catalogue', name: saved.name })
        : t('items.toast_saved', { defaultValue: 'Changes to {{name}} saved', name: saved.name }) });
      onSaved(saved);
    },
    onError: (e) => setServerErr(getErrorMessage(e)),
  });
  const addCat = useMutation({
    mutationFn: () => itemsApi.createCategory(newCat.trim()),
    onSuccess: (c) => {
      setNewCat('');
      set('category_id', c.id);
      qc.invalidateQueries({ queryKey: ['items', 'categories'] });
    },
    onError: (e) => setServerErr(getErrorMessage(e)),
  });

  const submit = () => {
    setTouched(true);
    if (Object.keys(errors).length === 0) save.mutate();
  };
  const requestClose = () => (dirty && !save.isPending ? setConfirmClose(true) : onClose());
  const applyMargin = () => {
    const p = priceForMargin(form.purchase_cost.replace(',', '.') || '0', targetMargin.replace(',', '.'));
    if (p) set('sales_price', p);
  };

  const title = isNew
    ? seed?.sku ? t('items.duplicate_title', { defaultValue: 'Duplicate item' }) : t('items.new_item', { defaultValue: 'New item' })
    : t('items.edit_title', { defaultValue: 'Edit {{name}}', name: item!.name });

  return (
    <>
      <SideDrawer
        open={open}
        onClose={requestClose}
        title={title}
        subtitle={isNew ? t('items.form_subtitle_new', { defaultValue: 'Only SKU and name are required; everything else can be filled in later.' }) : item!.sku}
        widthClass="max-w-2xl"
        busy={save.isPending}
        backdropCloses={false}
        headerActions={
          <Button size="sm" variant="primary" icon={<Save size={14} />} disabled={save.isPending} onClick={submit}>
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
        }
      >
        <form
          className="space-y-4 p-4 sm:p-5"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); submit(); } }}
          noValidate
        >
          {serverErr && (
            <p role="alert" className="rounded-lg border border-semantic-error/30 bg-semantic-error-bg px-3 py-2 text-sm text-semantic-error">{serverErr}</p>
          )}

          <Section title={t('items.section_basics', { defaultValue: 'Basics' })}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('items.col_sku', { defaultValue: 'SKU' }) + ' *'} error={err('sku')}>
                <input autoFocus className={clsx(control, 'font-mono')} value={form.sku} maxLength={64} onChange={(e) => set('sku', e.target.value)} />
              </Field>
              <Field label={t('items.col_name', { defaultValue: 'Name' }) + ' *'} error={err('name')}>
                <input className={control} value={form.name} maxLength={255} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label={t('items.col_type', { defaultValue: 'Type' })}>
                <div role="radiogroup" className="flex gap-1 rounded-lg border border-border bg-surface-secondary p-0.5">
                  {ITEM_TYPES.map((x) => (
                    <button
                      key={x}
                      type="button"
                      role="radio"
                      aria-checked={form.item_type === x}
                      onClick={() => setForm((f) => ({ ...f, item_type: x, stock_tracked: x === 'service' ? false : f.stock_tracked }))}
                      className={clsx('h-8 flex-1 rounded-md text-xs font-medium', form.item_type === x
                        ? 'bg-surface-primary text-content-primary shadow-sm' : 'text-content-secondary hover:text-content-primary')}
                    >
                      {t(`items.type_${x}`, { defaultValue: TYPE_LABEL[x] })}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t('items.col_category', { defaultValue: 'Category' })}>
                <div className="flex gap-2">
                  <select className={control} value={form.category_id ?? ''} onChange={(e) => set('category_id', e.target.value || null)}>
                    <option value="">{t('items.no_category', { defaultValue: 'No category' })}</option>
                    {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input
                    className={clsx(control, 'max-w-[9rem]')}
                    placeholder={t('items.new_category', { defaultValue: 'New category' })}
                    aria-label={t('items.new_category', { defaultValue: 'New category' })}
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newCat.trim()) addCat.mutate(); } }}
                  />
                </div>
              </Field>
              <Field label={t('items.barcode', { defaultValue: 'Barcode' })}>
                <input className={clsx(control, 'font-mono')} value={form.barcode} maxLength={64} onChange={(e) => set('barcode', e.target.value)} />
              </Field>
              <Field label={t('items.image_url', { defaultValue: 'Image link' })} hint={t('items.image_hint', { defaultValue: 'Optional. Without an image the initials are shown.' })}>
                <input className={control} value={form.image_url} maxLength={500} placeholder="https://" onChange={(e) => set('image_url', e.target.value)} />
              </Field>
              <Field className="sm:col-span-2" label={t('items.description', { defaultValue: 'Description' })} hint={t('items.description_hint', { defaultValue: 'Printed on quotes and invoices.' })}>
                <textarea className={clsx(control, 'h-auto py-2')} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-content-primary sm:col-span-2">
                <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
                {t('items.active_hint', { defaultValue: 'Active — can be picked on new documents' })}
              </label>
            </div>
          </Section>

          <Section title={t('items.section_pricing_tax', { defaultValue: 'Pricing & tax' })}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label={t('items.col_price', { defaultValue: 'Sales price' })} error={err('sales_price')}>
                <input className={clsx(control, 'text-right tabular-nums')} inputMode="decimal" value={form.sales_price} onChange={(e) => set('sales_price', e.target.value)} />
              </Field>
              <Field label={t('items.col_cost', { defaultValue: 'Cost' })} error={err('purchase_cost')}>
                <input className={clsx(control, 'text-right tabular-nums')} inputMode="decimal" value={form.purchase_cost} onChange={(e) => set('purchase_cost', e.target.value)} />
              </Field>
              <Field label={t('items.currency', { defaultValue: 'Currency' })} error={err('currency')}>
                <input className={clsx(control, 'uppercase')} value={form.currency} maxLength={3} onChange={(e) => set('currency', e.target.value)} />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-surface-secondary px-3 py-2.5 text-sm">
              <span className="text-content-secondary">{t('items.margin_label', { defaultValue: 'Margin' })}: <MarginText pct={margin} /></span>
              <span className="text-content-secondary">
                {t('items.profit_per_unit', { defaultValue: 'Profit per unit' })}:{' '}
                <span className={clsx('tabular-nums font-medium', profit < 0 ? 'text-semantic-error' : 'text-content-primary')}>
                  {fmtFixed(profit)} {form.currency.toUpperCase()}
                </span>
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <Calculator size={14} className="text-content-tertiary" />
                <input
                  className={clsx(control, 'h-8 w-20 text-right')}
                  inputMode="decimal"
                  placeholder="30"
                  aria-label={t('items.target_margin', { defaultValue: 'Target margin %' })}
                  value={targetMargin}
                  onChange={(e) => setTargetMargin(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyMargin(); } }}
                />
                <span className="text-xs text-content-tertiary">%</span>
                <Button size="sm" variant="secondary" type="button" disabled={!targetMargin} onClick={applyMargin}>
                  {t('items.set_price_from_margin', { defaultValue: 'Set price' })}
                </Button>
              </span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label={t('items.tax_code', { defaultValue: 'Tax code' })} hint={t('items.tax_code_hint', { defaultValue: 'e.g. standard, reduced, exempt' })}>
                <input className={control} value={form.tax_code} maxLength={16} onChange={(e) => set('tax_code', e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section
            title={t('items.section_inventory', { defaultValue: 'Inventory' })}
            hint={form.item_type === 'service' ? t('items.inventory_service_hint', { defaultValue: 'Services are not kept in stock.' }) : undefined}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm text-content-primary sm:col-span-3">
                <input
                  type="checkbox"
                  checked={form.stock_tracked}
                  disabled={form.item_type === 'service'}
                  onChange={(e) => set('stock_tracked', e.target.checked)}
                />
                {t('items.stock_tracked_hint', { defaultValue: 'Track stock — receipts add to on-hand quantity' })}
              </label>
              <Field label={t('items.col_uom', { defaultValue: 'Unit' })} hint={t('items.uom_hint', { defaultValue: 'e.g. pcs, h, kg, m' })} error={err('uom')}>
                <input className={control} value={form.uom} maxLength={16} onChange={(e) => set('uom', e.target.value)} />
              </Field>
              <Field label={t('items.min_stock', { defaultValue: 'Minimum stock' })} error={err('min_stock')}>
                <input className={clsx(control, 'text-right tabular-nums')} inputMode="decimal" disabled={!form.stock_tracked} value={form.min_stock} onChange={(e) => set('min_stock', e.target.value)} />
              </Field>
              <Field label={t('items.reorder_qty', { defaultValue: 'Reorder quantity' })} error={err('reorder_qty')}>
                <input className={clsx(control, 'text-right tabular-nums')} inputMode="decimal" disabled={!form.stock_tracked} value={form.reorder_qty} onChange={(e) => set('reorder_qty', e.target.value)} />
              </Field>
              <Field className="sm:col-span-3" label={t('items.default_supplier', { defaultValue: 'Default supplier' })}>
                <ContactSearchInput
                  value={form.default_supplier_id ?? ''}
                  onChange={(id) => set('default_supplier_id', id || null)}
                  placeholder={t('items.default_supplier_ph', { defaultValue: 'Search suppliers' })}
                />
              </Field>
            </div>
          </Section>

          <Section
            title={t('items.section_defaults', { defaultValue: 'Sales & purchase defaults' })}
            hint={t('items.defaults_hint', { defaultValue: 'Ledger accounts used when this item is invoiced or billed. Leave empty to use the module defaults.' })}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('items.revenue_account', { defaultValue: 'Revenue account' })}>
                <input className={clsx(control, 'font-mono')} value={form.revenue_account} maxLength={32} onChange={(e) => set('revenue_account', e.target.value)} />
              </Field>
              <Field label={t('items.expense_account', { defaultValue: 'Expense account' })}>
                <input className={clsx(control, 'font-mono')} value={form.expense_account} maxLength={32} onChange={(e) => set('expense_account', e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title={t('items.section_notes', { defaultValue: 'Notes' })}>
            <textarea
              className={clsx(control, 'h-auto py-2')}
              rows={3}
              aria-label={t('items.section_notes', { defaultValue: 'Notes' })}
              placeholder={t('items.notes_ph', { defaultValue: 'Internal notes, not printed on documents' })}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Section>

          <div className="flex items-center justify-between gap-2 border-t border-border-light pt-3">
            <span className="text-xs text-content-tertiary">
              {dirty ? t('items.unsaved', { defaultValue: 'Unsaved changes' }) : ' '}
              {touched && Object.keys(errors).length > 0 && (
                <span className="ml-2 text-semantic-error">{t('items.fix_errors', { defaultValue: 'Fix the highlighted fields.' })}</span>
              )}
            </span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={requestClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
              <Button type="submit" size="sm" variant="primary" icon={isNew && seed?.sku ? <Copy size={14} /> : <Save size={14} />} disabled={save.isPending}>
                {isNew ? t('items.create', { defaultValue: 'Create item' }) : t('common.save', { defaultValue: 'Save' })}
              </Button>
            </div>
          </div>
        </form>
      </SideDrawer>
      <ConfirmDialog
        open={confirmClose}
        variant="warning"
        title={t('items.discard_title', { defaultValue: 'Discard changes?' })}
        message={t('items.discard_body', { defaultValue: 'You have edits that are not saved yet.' })}
        confirmLabel={t('items.discard', { defaultValue: 'Discard' })}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => { setConfirmClose(false); onClose(); }}
      />
    </>
  );
}
