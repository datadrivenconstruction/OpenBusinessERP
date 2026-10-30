import type { ModuleGuideContent } from '@/shared/ui';

export const importGuide: ModuleGuideContent = {
  titleKey: 'guide.import.title',
  titleDefault: "Import data",
  introKey: 'guide.import.intro',
  introDefault:
    "Bring customers, suppliers, products, opening balances and open invoices over from a CSV or Excel file, check them first and undo if needed.",
  sections: [
    {
      icon: 'Database',
      titleKey: 'guide.import.choose.title',
      titleDefault: "Choose what to import",
      bodyKey: 'guide.import.choose.body',
      bodyDefault:
        "Pick customers, suppliers, products, opening balances, open invoices or open bills, then upload a CSV or XLSX file. A sample template shows the expected columns.",
    },
    {
      icon: 'Workflow',
      titleKey: 'guide.import.map.title',
      titleDefault: "Map your columns",
      bodyKey: 'guide.import.map.body',
      bodyDefault:
        "Match each column of your file to a field. Presets remember a mapping for files from the same source, so the next import is one click.",
    },
    {
      icon: 'ClipboardCheck',
      titleKey: 'guide.import.validate.title',
      titleDefault: "Check before saving",
      bodyKey: 'guide.import.validate.body',
      bodyDefault:
        "A dry run shows what would be created, updated or skipped, with every problem listed by row. Nothing is saved until you confirm.",
    },
    {
      icon: 'ListChecks',
      titleKey: 'guide.import.undo.title',
      titleDefault: "Undo if needed",
      bodyKey: 'guide.import.undo.body',
      bodyDefault:
        "Every import is logged. If something looks wrong, undo removes the records that import created.",
    },
  ],
  ctaKey: 'guide.import.cta',
  ctaDefault: "Upload your first file",
};
