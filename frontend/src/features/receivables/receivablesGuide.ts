// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction

import type { ModuleGuideContent } from '@/shared/ui';

export const receivablesGuide: ModuleGuideContent = {
  titleKey: 'guide.receivables.title',
  titleDefault: 'Receivables',
  introKey: 'guide.receivables.intro',
  introDefault:
    'Receivables shows who owes you money and for how long, and helps you chase overdue invoices with reviewed reminder letters.',
  sections: [
    {
      icon: 'Database',
      titleKey: 'guide.receivables.aging.title',
      titleDefault: 'Aging report',
      bodyKey: 'guide.receivables.aging.body',
      bodyDefault:
        'Open customer invoices are grouped by how far past due they are: not due, 1-30, 31-60, 61-90 and 90+ days. Click a customer to see the individual invoices, or change the as-of date.',
    },
    {
      icon: 'ListChecks',
      titleKey: 'guide.receivables.statement.title',
      titleDefault: 'Customer statements',
      bodyKey: 'guide.receivables.statement.body',
      bodyDefault:
        'Download a statement for any customer to show every open invoice and the total due.',
    },
    {
      icon: 'Workflow',
      titleKey: 'guide.receivables.dunning.title',
      titleDefault: 'Dunning runs',
      bodyKey: 'guide.receivables.dunning.body',
      bodyDefault:
        'A dunning run proposes reminder letters by overdue level. They are only drafts: edit, approve or discard each one, then send it yourself. Nothing leaves the system automatically.',
    },
    {
      icon: 'ClipboardCheck',
      titleKey: 'guide.receivables.exclude.title',
      titleDefault: 'Excluding customers',
      bodyKey: 'guide.receivables.exclude.body',
      bodyDefault:
        'Exclude a customer from dunning when a dispute or agreement is in place. They stay in the aging report but receive no reminder drafts.',
    },
  ],
  ctaKey: 'guide.receivables.cta',
  ctaDefault: 'Propose a dunning run',
};
