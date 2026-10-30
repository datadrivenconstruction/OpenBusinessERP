// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
// "How it works" content for the business home (BusinessHome).

import type { ModuleGuideContent } from '@/shared/ui';

export const businessHomeGuide: ModuleGuideContent = {
  titleKey: 'guide.biz_home.title',
  titleDefault: 'Your business home',
  introKey: 'guide.biz_home.intro',
  introDefault: 'The home page shows where your money stands and what needs a decision today. Every figure links to the page it comes from.',
  sections: [
    {
      icon: 'Wallet',
      titleKey: 'guide.biz_home.money.title',
      titleDefault: 'Money at a glance',
      bodyKey: 'guide.biz_home.money.body',
      bodyDefault: 'Cash in bank, receivables, payables and revenue this month, each compared with last month where the data allows.',
    },
    {
      icon: 'Bell',
      titleKey: 'guide.biz_home.attention.title',
      titleDefault: 'Needs attention',
      bodyKey: 'guide.biz_home.attention.body',
      bodyDefault: 'Overdue invoices, bills due within a week, unmatched bank lines, expiring quotes and drafts. Click a row to open the filtered list.',
    },
    {
      icon: 'ListChecks',
      titleKey: 'guide.biz_home.today.title',
      titleDefault: 'Today',
      bodyKey: 'guide.biz_home.today.body',
      bodyDefault: 'Tasks due or overdue, your next tasks and, where bookings are used, today\'s appointments.',
    },
  ],
};
