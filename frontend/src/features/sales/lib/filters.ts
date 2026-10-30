/** List filters <-> URL search params, so a filtered view is shareable and survives reload. */
import { SALES_KINDS, type SalesKind, type SalesListQuery } from '../api';

export interface SalesFilters {
  tab: SalesKind;
  q: string;
  status: string[];
  customer_id: string;
  customer_name: string;
  date_from: string;
  date_to: string;
  overdue: boolean;
  sort: string;
  page: number;
}

export const DEFAULT_SORT = '-doc_date';
export const PAGE_SIZE = 50;

export function filtersFromParams(p: URLSearchParams): SalesFilters {
  const tab = p.get('tab');
  const page = Number(p.get('page'));
  return {
    tab: SALES_KINDS.includes(tab as SalesKind) ? (tab as SalesKind) : 'quotes',
    q: p.get('q') ?? '',
    status: (p.get('status') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    customer_id: p.get('customer') ?? '',
    customer_name: p.get('customer_name') ?? '',
    date_from: p.get('from') ?? '',
    date_to: p.get('to') ?? '',
    overdue: p.get('overdue') === '1',
    sort: p.get('sort') || DEFAULT_SORT,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function filtersToParams(f: SalesFilters): URLSearchParams {
  const p = new URLSearchParams();
  p.set('tab', f.tab);
  if (f.q) p.set('q', f.q);
  if (f.status.length) p.set('status', f.status.join(','));
  if (f.customer_id) {
    p.set('customer', f.customer_id);
    if (f.customer_name) p.set('customer_name', f.customer_name);
  }
  if (f.date_from) p.set('from', f.date_from);
  if (f.date_to) p.set('to', f.date_to);
  if (f.overdue) p.set('overdue', '1');
  if (f.sort && f.sort !== DEFAULT_SORT) p.set('sort', f.sort);
  if (f.page > 1) p.set('page', String(f.page));
  return p;
}

export function hasActiveFilters(f: SalesFilters): boolean {
  return !!(f.q || f.status.length || f.customer_id || f.date_from || f.date_to || f.overdue);
}

export function clearFilters(f: SalesFilters): SalesFilters {
  return { ...f, q: '', status: [], customer_id: '', customer_name: '', date_from: '', date_to: '', overdue: false, page: 1 };
}

export function toListQuery(f: SalesFilters): SalesListQuery {
  return {
    q: f.q.trim() || undefined,
    status: f.status.length ? f.status : undefined,
    customer_id: f.customer_id || undefined,
    date_from: f.date_from || undefined,
    date_to: f.date_to || undefined,
    overdue: f.overdue || undefined,
    sort: f.sort,
    limit: PAGE_SIZE,
    offset: (f.page - 1) * PAGE_SIZE,
  };
}

/** Header click: the active column flips direction, a new column starts descending. */
export function nextSort(current: string, column: string): string {
  return current === `-${column}` ? column : `-${column}`;
}

export const STATUSES_BY_KIND: Record<SalesKind, string[]> = {
  quotes: ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted', 'cancelled'],
  orders: ['draft', 'confirmed', 'delivered', 'invoiced', 'cancelled'],
  invoices: ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'],
  'credit-notes': ['draft', 'issued', 'cancelled'],
};
