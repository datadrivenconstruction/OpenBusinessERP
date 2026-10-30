/** React-query hooks for the Sales API. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchSalesList,
  salesApi,
  type BulkAction,
  type ConvertBody,
  type SalesKind,
  type SalesListQuery,
} from './api';

export const salesKeys = {
  all: ['sales'] as const,
  list: (kind: SalesKind, q: SalesListQuery) => ['sales', kind, 'list', q] as const,
  stats: () => ['sales', 'stats'] as const,
  doc: (kind: SalesKind, id: string) => ['sales', kind, id] as const,
  activity: (kind: SalesKind, id: string) => ['sales', kind, id, 'activity'] as const,
  related: (kind: SalesKind, id: string) => ['sales', kind, id, 'related'] as const,
};

export function useSalesList(kind: SalesKind, q: SalesListQuery) {
  return useQuery({
    queryKey: salesKeys.list(kind, q),
    queryFn: () => fetchSalesList(kind, q),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useSalesStats() {
  return useQuery({ queryKey: salesKeys.stats(), queryFn: salesApi.stats, retry: false, staleTime: 30_000 });
}

export function useSalesDoc(kind: SalesKind, id: string | undefined) {
  return useQuery({
    queryKey: salesKeys.doc(kind, id ?? ''),
    queryFn: () => salesApi.get(kind, id!),
    enabled: !!id && id !== 'new',
  });
}

export function useSalesActivity(kind: SalesKind, id: string | undefined) {
  return useQuery({
    queryKey: salesKeys.activity(kind, id ?? ''),
    queryFn: () => salesApi.activity(kind, id!),
    enabled: !!id && id !== 'new',
    retry: false,
  });
}

export function useSalesRelated(kind: SalesKind, id: string | undefined) {
  return useQuery({
    queryKey: salesKeys.related(kind, id ?? ''),
    queryFn: () => salesApi.related(kind, id!),
    enabled: !!id && id !== 'new',
    retry: false,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: salesKeys.all });
}

export function useBulkAction(kind: SalesKind) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ action, ids }: { action: BulkAction; ids: string[] }) => salesApi.bulk(kind, action, ids),
    onSuccess: invalidate,
  });
}

export function useDuplicate(kind: SalesKind) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => salesApi.duplicate(kind, id), onSuccess: invalidate });
}

export function useConvert() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ from, id, body }: { from: 'quote' | 'order'; id: string; body: ConvertBody }) =>
      from === 'quote' ? salesApi.quoteToOrder(id, body) : salesApi.orderToInvoice(id, body),
    onSuccess: invalidate,
  });
}

export function useRecordPayment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; amount: string; pay_date?: string; reference?: string; method?: string }) =>
      salesApi.pay(id, body),
    onSuccess: invalidate,
  });
}
