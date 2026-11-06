/** Renders backend activity events and invoice-check issues from their codes; falls back to the server text. */
import type { TFunction } from 'i18next';
import { fmtCurrency } from '@/shared/lib/formatters';
import type { ActivityEntry } from '../api';

const NO_ESCAPE = { escapeValue: false };

export function activityText(t: TFunction, a: ActivityEntry): string {
  const p = a.params;
  if (!p) return a.message;
  const o = { interpolation: NO_ESCAPE, ...p };
  switch (a.type) {
    case 'created':
      return t('salesfeed.created', { defaultValue: 'Created {{number}}', ...o });
    case 'issued':
      return t('salesfeed.issued', { defaultValue: 'Issued {{number}} and posted to the general ledger', ...o });
    case 'sent':
      return t('salesfeed.sent', { defaultValue: 'Sent to {{to}}', ...o });
    case 'send_failed':
      return t('salesfeed.send_failed', { defaultValue: 'Sending to {{to}} failed: {{detail}}', ...o });
    case 'payment':
      return t('salesfeed.payment', {
        defaultValue: 'Payment {{amount}} ({{method}})',
        ...o,
        amount: fmtCurrency(Number(p.amount), p.currency || 'EUR'),
      });
    case 'credit_note':
      return t('salesfeed.credit_note', { defaultValue: 'Credit note {{number}} created', ...o });
    case 'derived':
      return t('salesfeed.derived', {
        defaultValue: '{{kind}} {{number}} created',
        ...o,
        kind: t(`sales.kind_${p.kind}`, { defaultValue: (p.kind ?? '').replace('_', ' ') }),
      });
    default:
      return a.message;
  }
}

/** Invoice-check issue text from its field code. */
export function checkText(t: TFunction, i: { field: string; message: string }): string {
  const line = /^line_(\d+)(_qty)?$/.exec(i.field);
  if (line) {
    const n = line[1];
    return line[2]
      ? t('invcheck.line_qty', { defaultValue: 'Position {{n}} has no quantity.', n })
      : t('invcheck.line_desc', { defaultValue: 'Position {{n}} has no description.', n });
  }
  switch (i.field) {
    case 'company_name':
      return t('invcheck.company_name', { defaultValue: 'Seller name is missing (Settings > Company details & documents).' });
    case 'company_address':
      return t('invcheck.company_address', { defaultValue: 'Seller address is missing (Settings > Company details & documents).' });
    case 'tax_id':
      return t('invcheck.tax_id', { defaultValue: 'Seller tax number or VAT ID is missing.' });
    case 'customer_name':
      return t('invcheck.customer_name', { defaultValue: 'Customer name is missing.' });
    case 'customer_address':
      return t('invcheck.customer_address', { defaultValue: 'Customer address is missing.' });
    case 'doc_date':
      return t('invcheck.doc_date', { defaultValue: 'Invoice date is missing.' });
    case 'number':
      return t('invcheck.number', { defaultValue: 'Sequential invoice number is missing.' });
    case 'delivery_date':
      return t('invcheck.delivery_date', { defaultValue: 'Delivery date or service period is missing.' });
    case 'lines':
      return t('invcheck.lines', { defaultValue: 'The invoice has no positions.' });
    case 'tax_note':
      return t('invcheck.tax_note', { defaultValue: 'A 0 % line needs a note on the tax exemption or reverse charge.' });
    case 'customer_vat_id':
      return t('invcheck.customer_vat_id', { defaultValue: "Reverse charge usually needs the customer's VAT ID." });
    default:
      return i.message;
  }
}
