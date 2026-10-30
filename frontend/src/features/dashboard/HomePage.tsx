// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { useIsBusinessCompany } from '@/app/layout/useCompanyWorkspace';
import { BusinessHome } from './BusinessHome';
import { DashboardPage as ConstructionDashboard } from './DashboardPage';

/** Business presets get the business home; construction keeps its dashboard. */
export function HomePage() {
  return useIsBusinessCompany() ? <BusinessHome /> : <ConstructionDashboard />;
}
