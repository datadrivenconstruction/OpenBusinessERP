// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction

import type { ModuleGuideContent } from '@/shared/ui';

export const purchasingGuide: ModuleGuideContent = {
  titleKey: 'guide.purchasing.title',
  titleDefault: 'Purchasing',
  introKey: 'guide.purchasing.intro',
  introDefault:
    'Purchasing covers what you buy from suppliers: purchase orders, goods receipts and supplier bills. Each step is matched against the previous one so you only pay for what was ordered and received.',
  sections: [
    {
      icon: 'Database',
      titleKey: 'guide.purchasing.orders.title',
      titleDefault: 'Purchase orders',
      bodyKey: 'guide.purchasing.orders.body',
      bodyDefault:
        'A purchase order lists the items, quantities and prices agreed with a supplier. Save it as a draft, then confirm it to make it binding and ready for receiving.',
    },
    {
      icon: 'ListChecks',
      titleKey: 'guide.purchasing.receipts.title',
      titleDefault: 'Receiving goods',
      bodyKey: 'guide.purchasing.receipts.body',
      bodyDefault:
        'When goods arrive, receive them against the order in full or in part. The Receipts tab shows every delivery and lets you create a bill from it.',
    },
    {
      icon: 'ClipboardCheck',
      titleKey: 'guide.purchasing.bills.title',
      titleDefault: 'Bills and 3-way match',
      bodyKey: 'guide.purchasing.bills.body',
      bodyDefault:
        'A bill is compared with the order price and the received quantity. The match chip tells you whether it is clean, over-billed or still waiting for goods, before you post it.',
    },
    {
      icon: 'Workflow',
      titleKey: 'guide.purchasing.payments.title',
      titleDefault: 'Posting and paying',
      bodyKey: 'guide.purchasing.payments.body',
      bodyDefault:
        'Posting a bill books it to the ledger. Record payments on the bill to track the open amount until it is fully paid.',
    },
  ],
  ctaKey: 'guide.purchasing.cta',
  ctaDefault: 'Create a purchase order',
};
