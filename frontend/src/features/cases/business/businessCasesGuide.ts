import type { ModuleGuideContent } from '@/shared/ui';

export const businessCasesGuide: ModuleGuideContent = {
  titleKey: 'guide.bizcases.title',
  titleDefault: 'Guided cases',
  introKey: 'guide.bizcases.intro',
  introDefault:
    "Guided cases are short, step-by-step walkthroughs of everyday business tasks. Each step opens the right screen so you learn by doing.",
  sections: [
    {
      icon: 'Rocket',
      titleKey: 'guide.bizcases.start.title',
      titleDefault: "Start with a goal",
      bodyKey: 'guide.bizcases.start.body',
      bodyDefault:
        "Each case is a short walkthrough of an everyday task, such as quote to cash or reconciling the bank. Pick one that matches what you need to get done today.",
    },
    {
      icon: 'Workflow',
      titleKey: 'guide.bizcases.steps.title',
      titleDefault: "Follow the steps",
      bodyKey: 'guide.bizcases.steps.body',
      bodyDefault:
        "A case lists its steps in order. Each step has an Open button that takes you straight to the right screen, and a note on what to look for once you are there.",
    },
    {
      icon: 'ListChecks',
      titleKey: 'guide.bizcases.progress.title',
      titleDefault: "Tick off your progress",
      bodyKey: 'guide.bizcases.progress.body',
      bodyDefault:
        "Mark a step as done and your progress is remembered on this device, so you can leave and come back where you stopped.",
    },
    {
      icon: 'Search',
      titleKey: 'guide.bizcases.filter.title',
      titleDefault: "Filter for your business",
      bodyKey: 'guide.bizcases.filter.body',
      bodyDefault:
        "Choose the kind of business you run and a topic such as Sales, Purchasing or Finance, or search by keyword, to see only the cases that fit.",
    },
  ],
  ctaKey: 'guide.bizcases.cta',
  ctaDefault: 'Browse the cases',
};
