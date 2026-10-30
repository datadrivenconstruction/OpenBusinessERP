import type { ModuleGuideContent } from '@/shared/ui';

export const itemsGuide: ModuleGuideContent = {
  titleKey: 'guide.items.title',
  titleDefault: 'Products & services',
  introKey: 'guide.items.intro',
  introDefault:
    'Products & services is the catalogue of everything you sell or buy. Each item carries its SKU, unit, prices and accounts, and is reused by sales, purchasing and stock.',
  sections: [
    {
      icon: 'Database',
      titleKey: 'guide.items.catalogue.title',
      titleDefault: 'Build your catalogue',
      bodyKey: 'guide.items.catalogue.body',
      bodyDefault:
        'Each item has a unique SKU, a name, a type (goods, service or consumable), a unit of measure and a category. New item opens the form; Import CSV loads many items at once from a file with sku and name columns.',
    },
    {
      icon: 'ListChecks',
      titleKey: 'guide.items.pricing.title',
      titleDefault: 'Prices and costs',
      bodyKey: 'guide.items.pricing.body',
      bodyDefault:
        'Every item holds a sales price and a purchase cost in its own currency. Price lists add customer-specific or volume prices on top, with validity dates and quantity breaks.',
    },
    {
      icon: 'Workflow',
      titleKey: 'guide.items.accounts.title',
      titleDefault: 'Accounts and tax',
      bodyKey: 'guide.items.accounts.body',
      bodyDefault:
        'Set the tax code and the revenue and expense accounts on an item so that invoices and bills post to the right ledger lines automatically.',
    },
    {
      icon: 'Layers',
      titleKey: 'guide.items.stock.title',
      titleDefault: 'Stock and filters',
      bodyKey: 'guide.items.stock.body',
      bodyDefault:
        'Mark goods as stock-tracked to follow quantities. Search by SKU, name or barcode, filter by type or category, and show inactive items when you need to review retired products.',
    },
  ],
  ctaKey: 'guide.items.cta',
  ctaDefault: 'Add your first item',
};
