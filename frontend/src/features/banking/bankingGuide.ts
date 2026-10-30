import type { ModuleGuideContent } from '@/shared/ui';

export const bankingGuide: ModuleGuideContent = {
  titleKey: 'guide.banking.title',
  titleDefault: "Banking",
  introKey: 'guide.banking.intro',
  introDefault:
    "Match bank statement lines to invoices and bills, book the rest to accounts, and keep your cash records in step with the bank.",
  sections: [
    {
      icon: 'Database',
      titleKey: 'guide.banking.import.title',
      titleDefault: "Import statements",
      bodyKey: 'guide.banking.import.body',
      bodyDefault:
        "Upload a statement exported from your online banking (camt.053, MT940 or CSV) on the Import tab. Lines already imported are recognised and skipped, so you can safely re-upload overlapping periods.",
    },
    {
      icon: 'Sparkles',
      titleKey: 'guide.banking.reconcile.title',
      titleDefault: "Reconcile with suggestions",
      bodyKey: 'guide.banking.reconcile.body',
      bodyDefault:
        "Each open line gets ranked suggestions from your invoices and bills, scored by amount, reference and counterparty. Choose one and confirm, or use the keyboard: j/k to move, 1-5 to choose, Enter to confirm.",
    },
    {
      icon: 'ListChecks',
      titleKey: 'guide.banking.book.title',
      titleDefault: "Book, ignore or undo",
      bodyKey: 'guide.banking.book.body',
      bodyDefault:
        "Lines with no counterpart can be booked straight to an account or ignored. Any match can be undone, which reopens the invoices it settled.",
    },
    {
      icon: 'Layers',
      titleKey: 'guide.banking.accounts.title',
      titleDefault: "Accounts and tolerances",
      bodyKey: 'guide.banking.accounts.body',
      bodyDefault:
        "Add your bank accounts with their IBAN and ledger account, and set a write-off account, a maximum write-off and an amount tolerance for small differences.",
    },
  ],
  ctaKey: 'guide.banking.cta',
  ctaDefault: "Import your first statement",
};
