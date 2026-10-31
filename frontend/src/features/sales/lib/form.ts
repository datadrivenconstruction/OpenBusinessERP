/** Editable form state of a sales document and its request body. */
import type { SalesDoc, SalesDocInput, SalesLine } from '../api';

export interface SalesForm {
  customer_id: string;
  customer_name: string;
  currency: string;
  /** '' = automatic (FX register rate on the document date). */
  fx_rate: string;
  doc_date: string;
  due_date: string;
  notes: string;
  customer_address: string;
  customer_vat_id: string;
  customer_email: string;
  language: string;
  delivery_date: string;
  delivery_end: string;
  tax_note: string;
  payment_terms: string;
  lines: SalesLine[];
}

export const emptyLine = (taxRate = '0'): SalesLine => ({
  sku: '',
  description: '',
  qty: '1',
  unit_price: '0',
  discount_pct: '0',
  tax_rate: taxRate,
});

export const toForm = (d?: SalesDoc, currency = 'EUR', taxRate = '0'): SalesForm => ({
  customer_id: d?.customer_id ?? '',
  customer_name: d?.customer_name ?? '',
  currency: d?.currency ?? currency,
  fx_rate: d && Number(d.fx_rate) !== 1 ? String(d.fx_rate) : '',
  doc_date: d?.doc_date ?? new Date().toISOString().slice(0, 10),
  due_date: d?.due_date ?? '',
  notes: d?.notes ?? '',
  customer_address: d?.customer_address ?? '',
  customer_vat_id: d?.customer_vat_id ?? '',
  customer_email: d?.customer_email ?? '',
  language: d?.language ?? '',
  delivery_date: d?.delivery_date ?? '',
  delivery_end: d?.delivery_end ?? '',
  tax_note: d?.tax_note ?? '',
  payment_terms: d?.payment_terms ?? '',
  lines:
    d?.lines.map((l) => ({
      ...l,
      qty: String(l.qty),
      unit_price: String(l.unit_price),
      discount_pct: String(l.discount_pct),
      tax_rate: String(l.tax_rate),
    })) ?? [emptyLine(taxRate)],
});

export function toBody(f: SalesForm): SalesDocInput {
  return {
    customer_id: f.customer_id || null,
    customer_name: f.customer_name,
    currency: f.currency.toUpperCase(),
    fx_rate: Number(f.fx_rate) > 0 ? f.fx_rate : null,
    doc_date: f.doc_date || null,
    due_date: f.due_date || null,
    notes: f.notes,
    customer_address: f.customer_address,
    customer_vat_id: f.customer_vat_id,
    customer_email: f.customer_email,
    language: f.language,
    delivery_date: f.delivery_date || null,
    delivery_end: f.delivery_end || null,
    tax_note: f.tax_note,
    payment_terms: f.payment_terms,
    lines: f.lines.map(({ item_id, sku, description, qty, unit_price, discount_pct, tax_rate }) => ({
      item_id: item_id ?? null,
      sku,
      description,
      qty: qty || '0',
      unit_price: unit_price || '0',
      discount_pct: discount_pct || '0',
      tax_rate: tax_rate || '0',
    })),
  };
}

export type FormErrors = Partial<Record<'customer' | 'currency' | 'doc_date' | 'due_date' | 'lines', string>>;
