import type { ModuleGuideContent } from '@/shared/ui';

export const accountingGuide: ModuleGuideContent = {
  titleKey: 'guide.accounting.title',
  titleDefault: 'Accounting',
  introKey: 'guide.accounting.intro',
  introDefault:
    'Accounting keeps your general ledger. Sales invoices, supplier bills and payments post here automatically, and you can add manual entries when something has no document behind it.',
  sections: [
    {
      icon: 'Layers',
      titleKey: 'guide.accounting.accounts.title',
      titleDefault: 'Chart of accounts',
      bodyKey: 'guide.accounting.accounts.body',
      bodyDefault:
        'Accounts are grouped into assets, liabilities, equity, income and expenses, and can be nested. Open an account to see its ledger: every posted line with a running balance.',
    },
    {
      icon: 'ListChecks',
      titleKey: 'guide.accounting.journal.title',
      titleDefault: 'Journal entries',
      bodyKey: 'guide.accounting.journal.body',
      bodyDefault:
        'An entry balances debits and credits across two or more accounts. Save it as a draft, then post it. A posted entry is never edited: you reverse it, which creates a mirror entry.',
    },
    {
      icon: 'Workflow',
      titleKey: 'guide.accounting.automatic.title',
      titleDefault: 'Automatic postings',
      bodyKey: 'guide.accounting.automatic.body',
      bodyDefault:
        'Documents from Sales, Purchasing and Banking create their own entries. The source column on the journal shows where each entry came from.',
    },
    {
      icon: 'ClipboardCheck',
      titleKey: 'guide.accounting.reports.title',
      titleDefault: 'Reports for a period',
      bodyKey: 'guide.accounting.reports.body',
      bodyDefault:
        'Pick a period to see the trial balance, profit and loss and balance sheet. Click an account in any report to drill into its ledger, and export the result as CSV.',
    },
  ],
  ctaKey: 'guide.accounting.cta',
  ctaDefault: 'Create a journal entry',
};
