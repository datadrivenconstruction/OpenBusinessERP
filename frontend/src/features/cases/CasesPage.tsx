// Cases hub: business playbooks only.
import { useParams } from 'react-router-dom';
import { BusinessCasesHub } from './business/BusinessCasesHub';

export function CasesPage() {
  const { playbookId } = useParams<{ playbookId?: string }>();
  return <BusinessCasesHub caseId={playbookId} />;
}
