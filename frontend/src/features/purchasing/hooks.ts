/** React-query hooks for Purchasing. All keys start with 'purchasing' so one invalidation refreshes the module. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { purchasingApi, type BulkAction, type ListQuery, type PurchasingKind } from './api';

export const pk = {
  all: ['purchasing'] as const,
  list: (kind: PurchasingKind, q: ListQuery) => ['purchasing', 'list', kind, q] as const,
  stats: ['purchasing', 'stats'] as const,
  doc: (kind: PurchasingKind, id?: string) => ['purchasing', kind, id] as const,
  activity: (kind: PurchasingKind, id: string) => ['purchasing', 'activity', kind, id] as const,
  related: (kind: PurchasingKind, id: string) => ['purchasing', 'related', kind, id] as const,
};

export function usePurchasingList(kind: PurchasingKind, q: ListQuery, enabled = true) {
  return useQuery({
    queryKey: pk.list(kind, q),
    queryFn: () => purchasingApi.query(kind, q),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function usePurchasingStats() {
  return useQuery({ queryKey: pk.stats, queryFn: purchasingApi.stats, retry: false, staleTime: 30_000 });
}

export function usePurchasingDoc(kind: PurchasingKind, id: string | undefined) {
  return useQuery({ queryKey: pk.doc(kind, id), queryFn: () => purchasingApi.get(kind, id!), enabled: !!id && id !== 'new' });
}

export function usePurchasingActivity(kind: PurchasingKind, id: string | undefined) {
  return useQuery({
    queryKey: pk.activity(kind, id ?? ''),
    queryFn: () => purchasingApi.activity(kind, id!),
    enabled: !!id,
    retry: false,
  });
}

export function usePurchasingRelated(kind: PurchasingKind, id: string | undefined) {
  return useQuery({
    queryKey: pk.related(kind, id ?? ''),
    queryFn: async () => {
      if (kind === 'orders') {
        const r = await purchasingApi.orderRelated(id!);
        return { kind: 'order' as const, order: r };
      }
      const r = await purchasingApi.billRelated(kind, id!);
      return { kind: 'bill' as const, bill: r };
    },
    enabled: !!id,
    retry: false,
  });
}

export function useInvalidatePurchasing() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: pk.all });
}

export function usePurchasingBulk(kind: PurchasingKind) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ action, ids }: { action: BulkAction; ids: string[] }) => purchasingApi.bulk(kind, action, ids),
    onSuccess: () => void invalidate(),
  });
}

export function useDuplicateDoc() {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ kind, id }: { kind: PurchasingKind; id: string }) => purchasingApi.duplicate(kind, id),
    onSuccess: () => void invalidate(),
  });
}
