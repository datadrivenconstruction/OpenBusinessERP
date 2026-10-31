/** API helpers for recurring invoices, backed by /api/v1/recurring/. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/shared/lib/api';
import type { SalesLine } from './api';

export type RecurringInterval = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringStatus = 'active' | 'paused' | 'ended';
export const RECURRING_INTERVALS: RecurringInterval[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

export interface RecurringInput {
  name: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_address: string;
  currency: string;
  notes: string;
  interval: RecurringInterval;
  interval_count: number;
  start_date: string;
  end_date: string | null;
  max_count: number | null;
  day_of_month: number | null;
  payment_terms_days: number;
  auto_issue: boolean;
  auto_send: boolean;
  lines: SalesLine[];
}

export interface RecurringTemplate extends RecurringInput {
  id: string;
  status: RecurringStatus;
  net_total: string;
  gross_total: string;
  next_run_date: string | null;
  generated_count: number;
  last_document_id: string | null;
  last_run_at: string | null;
  last_error: string;
  created_at: string;
}

export interface RecurringRun {
  id: string;
  period_date: string;
  document_id: string | null;
  document_number: string;
  gross_total: string;
  status: string;
  detail: string;
  trigger: string;
  created_at: string;
}

export interface RecurringSummary {
  active: number;
  paused: number;
  ended: number;
  due_next_7_days: number;
  mrr: Record<string, string>;
  arr: Record<string, string>;
}

export interface GenerateResult {
  template_id: string;
  period_date: string | null;
  document_id: string | null;
  status: string;
  detail: string;
}

interface Page<T> {
  items: T[];
  total: number;
}

const BASE = '/v1/recurring/';
const KEY = ['recurring'];

export const useRecurringList = () => useQuery({ queryKey: [...KEY, 'list'], queryFn: () => apiGet<Page<RecurringTemplate>>(BASE).then((p) => p.items) });
export const useRecurringSummary = () =>
  useQuery({ queryKey: [...KEY, 'summary'], queryFn: () => apiGet<RecurringSummary>(`${BASE}summary/`) });
export const useRecurringRuns = (id: string | null) =>
  useQuery({
    queryKey: [...KEY, 'runs', id],
    queryFn: () => apiGet<Page<RecurringRun>>(`${BASE}${id}/runs/`).then((p) => p.items),
    enabled: !!id,
  });

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ['sales'] });
  };
}

export function useSaveRecurring() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: RecurringInput }) =>
      id ? apiPatch<RecurringTemplate>(`${BASE}${id}/`, body) : apiPost<RecurringTemplate>(BASE, body),
    onSuccess: done,
  });
}

export function useRecurringAction() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'generate' | 'delete' }) =>
      action === 'delete'
        ? apiDelete(`${BASE}${id}/`).then(() => null)
        : apiPost<RecurringTemplate | GenerateResult>(`${BASE}${id}/${action}/`, {}),
    onSuccess: done,
  });
}

/** Net amount per month for one template, the basis of the MRR figure. */
export function monthlyValue(net: number, interval: RecurringInterval, count: number): number {
  const n = Math.max(1, count);
  if (interval === 'weekly') return (net * 52) / 12 / n;
  return net / ({ monthly: 1, quarterly: 3, yearly: 12 }[interval] * n);
}
