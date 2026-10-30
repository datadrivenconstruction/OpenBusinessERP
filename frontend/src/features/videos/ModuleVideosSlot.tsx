// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Mounted once in the app shell. On a screen the catalogue links videos to,
// and unless the reader hid the hint, it loads the "Videos for this step"
// panel; everywhere else it renders nothing and loads nothing.

import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { useIsBusinessCompany } from '@/app/layout/useCompanyWorkspace';
import { useVideoHintsStore, videoRouteFor } from './videoRoutes';

const ModuleVideosPanel = lazy(() => import('./ModuleVideosPanel'));

export function ModuleVideosSlot() {
  const { pathname } = useLocation();
  const isBusiness = useIsBusinessCompany();
  const route = videoRouteFor(pathname);
  const hidden = useVideoHintsStore((s) => (route ? s.off || s.hidden.includes(route) : true));
  if (isBusiness || !route || hidden) return null;
  return (
    <Suspense fallback={null}>
      <ModuleVideosPanel key={route} route={route} />
    </Suspense>
  );
}
