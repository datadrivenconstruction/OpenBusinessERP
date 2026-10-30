// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction

import type { ModuleGuideContent } from '@/shared/ui';

export const salesGuide: ModuleGuideContent = {
  titleKey: 'guide.sales.title',
  titleDefault: 'Sales',
  introKey: 'guide.sales.intro',
  introDefault:
    'Sales takes a customer deal from quote to cash: quotes, orders, invoices and credit notes, each created from the previous document so nothing is retyped.',
  sections: [
    {
      icon: 'Database',
      titleKey: 'guide.sales.quotes.title',
      titleDefault: 'Quotes and orders',
      bodyKey: 'guide.sales.quotes.body',
      bodyDefault:
        'Start with a quote for a customer. When they accept, convert it into an order, and confirm the order to lock the terms.',
    },
    {
      icon: 'ListChecks',
      titleKey: 'guide.sales.invoices.title',
      titleDefault: 'Invoices',
      bodyKey: 'guide.sales.invoices.body',
      bodyDefault:
        'Create an invoice from a confirmed order. Issuing it assigns the final number and posts it to the ledger. The Open column shows what the customer still owes.',
    },
    {
      icon: 'Workflow',
      titleKey: 'guide.sales.payments.title',
      titleDefault: 'Payments and credit notes',
      bodyKey: 'guide.sales.payments.body',
      bodyDefault:
        'Record payments on an issued invoice until it is paid. To correct an invoice, issue a credit note that reverses it.',
    },
    {
      icon: 'ClipboardCheck',
      titleKey: 'guide.sales.output.title',
      titleDefault: 'Print and send',
      bodyKey: 'guide.sales.output.body',
      bodyDefault:
        'Download a document as PDF or e-mail it to the customer. A completeness check flags missing details before you send, and the send history is kept on the document.',
    },
  ],
  ctaKey: 'guide.sales.cta',
  ctaDefault: 'Create a document',
};
