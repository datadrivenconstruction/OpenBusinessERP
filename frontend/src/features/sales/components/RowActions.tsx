import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, Copy, CreditCard, FileDown, Mail } from 'lucide-react';
import type { SalesDocSummary } from '../api';
import { balanceDue } from '../lib/totals';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';

export interface RowActionHandlers {
  pdf: (d: SalesDocSummary) => void;
  send: (d: SalesDocSummary) => void;
  duplicate: (d: SalesDocSummary) => void;
  convert: (d: SalesDocSummary) => void;
  pay: (d: SalesDocSummary) => void;
}

export function canConvert(d: Pick<SalesDocSummary, 'kind' | 'status'>): boolean {
  return (d.kind === 'quote' && ['sent', 'accepted'].includes(d.status)) || (d.kind === 'order' && ['confirmed', 'delivered'].includes(d.status));
}

export function canPay(d: SalesDocSummary): boolean {
  return d.kind === 'invoice' && ['issued', 'partially_paid'].includes(d.status) && balanceDue(d) > 0;
}

export function RowActions({ doc, handlers }: { doc: SalesDocSummary; handlers: RowActionHandlers }) {
  const { t } = useTranslation();
  const items: ActionMenuItem[] = [
    { key: 'pdf', label: t('sales.download_pdf', { defaultValue: 'Download PDF' }), icon: <FileDown size={14} />, onSelect: () => handlers.pdf(doc) },
    { key: 'send', label: t('sales.send_email', { defaultValue: 'Send by email' }), icon: <Mail size={14} />, onSelect: () => handlers.send(doc) },
    { key: 'dup', label: t('sales.action_duplicate', { defaultValue: 'Duplicate' }), icon: <Copy size={14} />, onSelect: () => handlers.duplicate(doc) },
  ];
  if (canConvert(doc))
    items.push({
      key: 'convert',
      label: doc.kind === 'quote' ? t('sales.action_to_order', { defaultValue: 'Convert to order' }) : t('sales.action_to_invoice', { defaultValue: 'Create invoice' }),
      icon: <ArrowRightLeft size={14} />,
      onSelect: () => handlers.convert(doc),
    });
  if (canPay(doc))
    items.push({ key: 'pay', label: t('sales.record_payment', { defaultValue: 'Record payment' }), icon: <CreditCard size={14} />, onSelect: () => handlers.pay(doc) });
  return <ActionMenu items={items} label={t('sales.row_actions', { defaultValue: 'Actions for {{number}}', number: doc.number })} />;
}
