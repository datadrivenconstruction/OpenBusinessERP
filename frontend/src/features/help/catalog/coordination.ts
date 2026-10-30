// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// How-it-works catalog — Model coordination domain.
// See ../types.ts for the shape + key convention, and
// ../catalog/overview-estimating.ts for a fully-worked example.

import type { ModuleExplanation } from '../types';

export const coordinationModules: ModuleExplanation[] = [
  {
    id: 'requirements-matrix',
    route: '/requirements/matrix',
    icon: 'ClipboardCheck',
    category: 'coordination',
    keywords: 'requirements matrix eir iso 19650 deliverable coverage lod loi information cobie pset',
    titleKey: 'howto.requirements-matrix.title',
    titleDefault: 'Requirements Matrix',
    summaryKey: 'howto.requirements-matrix.summary',
    summaryDefault: 'Track what information must be delivered and whether it is actually present.',
    whatKey: 'howto.requirements-matrix.what',
    whatDefault:
      'The Requirements Matrix is an information-requirements register. Each row is a requirement written as an entity, an attribute and a constraint; each column is a kind of deliverable that can prove it - model, drawing, schedule, report, COBie or property set. The grid gives you a live, colour-coded read-out of how much of the required information has actually been delivered and accepted.',
    how: [
      { key: 'howto.requirements-matrix.how.1', default: 'Create a requirement set for the project to hold its requirements.' },
      { key: 'howto.requirements-matrix.how.2', default: 'Add requirements as rows - for example exterior wall, fire rating, equals F90 - with a priority for each.' },
      { key: 'howto.requirements-matrix.how.3', default: 'Click a cell to attach the deliverable that satisfies a requirement and record its level of information and status.' },
      { key: 'howto.requirements-matrix.how.4', default: 'Watch the colours - green for accepted, amber for submitted, red for missing - and work the red cells until the coverage is complete.' },
    ],
    tips: [
      { key: 'howto.requirements-matrix.tip.1', default: 'Mark the truly essential requirements as must so a reviewer can tell critical gaps apart from nice-to-have ones at a glance.' },
    ],
    whenKey: 'howto.requirements-matrix.when',
    whenDefault: 'Use it to agree deliverables at the start of a project and to prove, at each milestone, that the required information was handed over.',
  },
];
