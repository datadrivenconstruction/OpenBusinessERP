import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/shared/lib/api';

export interface BusinessDemoCase {
  key: string;
  company: string;
  country: string;
  industry: string;
  summary: string;
  installed: boolean;
}

export const BUSINESS_DEMO_KEY = ['business-demo', 'cases'] as const;

export const fetchBusinessDemoCases = () => apiGet<BusinessDemoCase[]>('/v1/business-demo/cases/');
export const installBusinessDemoCase = (key: string) =>
  apiPost(`/v1/business-demo/cases/${encodeURIComponent(key)}/install/`, {});

export function useBusinessDemoCases(enabled = true) {
  return useQuery({ queryKey: BUSINESS_DEMO_KEY, queryFn: fetchBusinessDemoCases, enabled, retry: false });
}

export function useInstallBusinessDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: installBusinessDemoCase,
    onSuccess: () => {
      // Sample records show up on every business screen.
      void qc.invalidateQueries();
    },
  });
}
