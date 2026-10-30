import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const d = new Date();
const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const today = iso(d);
const inDays = (n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return iso(x); };

let routes: Record<string, unknown> = {};
const fail = new Set<string>();

function baseRoutes(): Record<string, unknown> {
  return {
    '/v1/business-settings/': { company_name: 'Acme Ltd', base_currency: 'EUR' },
    '/v1/sales/summary/': {
      currency: 'EUR', receivables: '1190.00', overdue_count: 2, open_quotes_value: '1000.00',
      open_orders_value: '500.00', payables: '250.00', revenue_this_month: '900.00',
      revenue_by_month: [{ month: '2026-09', revenue: '400.00' }, { month: today.slice(0, 7), revenue: '900.00' }],
    },
    '/v1/purchasing/summary/': { currency: 'EUR', open_po_value: '0', bills_due: '0', overdue_count: 0, overdue_value: '0', payables: '4321.00' },
    '/v1/receivables/aging/': { as_of: today, totals: {}, rows: [
      { partner_key: 'p1', customer_id: null, customer_name: 'Big Buyer GmbH', total: '800', current: '300', d1_30: '500', d31_60: '0', d61_90: '0', d90_plus: '0', invoices: [] },
    ] },
    '/v1/purchasing/bills/': [
      { id: 'b1', number: 'B1', status: 'posted', supplier_id: null, supplier_name: 'S', currency: 'EUR', doc_date: today, due_date: inDays(3), net_total: '100', tax_total: '0', gross_total: '100', amount_paid: '0' },
      { id: 'b2', number: 'B2', status: 'posted', supplier_id: null, supplier_name: 'S', currency: 'EUR', doc_date: today, due_date: inDays(2), net_total: '50', tax_total: '0', gross_total: '50', amount_paid: '0' },
    ],
    '/v1/sales/invoices/': [{ id: 'i1', status: 'draft', gross_total: '10', amount_paid: '0', due_date: null, doc_date: today }],
    '/v1/sales/quotes/': [{ id: 'q1', status: 'sent', gross_total: '10', amount_paid: '0', due_date: inDays(4), doc_date: today }],
    '/v1/banking/accounts/': [],
    '/v1/banking/transactions/': [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }],
    '/v1/tasks/my-tasks/': { items: [
      { id: 't1', title: 'Call supplier', status: 'open', due_date: today, is_overdue: false },
      { id: 't2', title: 'Later thing', status: 'open', due_date: '2999-01-01', is_overdue: false },
    ] },
    '/v1/contacts/': { items: [], total: 0, offset: 0, limit: 1 },
    '/v1/business-demo/cases/': [],
    '/v1/appointments/bookings/': [],
  };
}

vi.mock('@/shared/lib/api', () => ({
  apiGet: vi.fn((url: string) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key || fail.has(key)) return Promise.reject(new Error('fail ' + url));
    return Promise.resolve(routes[key]);
  }),
  apiPost: vi.fn(), apiPatch: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(),
}));

import { BusinessHome } from '../BusinessHome';

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><BusinessHome /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { routes = baseRoutes(); fail.clear(); localStorage.clear(); });

describe('BusinessHome', () => {
  it('renders KPIs from the summaries and due tasks', async () => {
    renderHome();
    expect(await screen.findByText(/Acme Ltd/)).toBeTruthy();
    expect(await screen.findByText(/1\.190|1,190/)).toBeTruthy();
    expect(await screen.findByText(/4\.321|4,321/)).toBeTruthy();
    expect(screen.getByText('2 overdue')).toBeTruthy();
    expect(await screen.findByText('Call supplier')).toBeTruthy();
    expect(screen.queryByText('Later thing')).toBeNull();
    expect(screen.getAllByTestId('biz-kpi')).toHaveLength(4);
    expect(document.body.textContent).not.toContain('$');
    expect(screen.getByText('New purchase order').closest('button')).toBeTruthy();
    expect(screen.getByText('Upload bank statement').closest('a')?.getAttribute('href')).toBe('/banking');
  });

  it('counts items in the attention list', async () => {
    renderHome();
    const bank = await screen.findByTestId('biz-att-bank');
    expect(within(bank).getByTestId('biz-att-count').textContent).toBe('3');
    expect(within(screen.getByTestId('biz-att-bills')).getByTestId('biz-att-count').textContent).toBe('2');
    expect(within(screen.getByTestId('biz-att-overdue')).getByTestId('biz-att-count').textContent).toBe('2');
    expect(within(screen.getByTestId('biz-att-quotes')).getByTestId('biz-att-count').textContent).toBe('1');
    expect(within(screen.getByTestId('biz-att-drafts')).getByTestId('biz-att-count').textContent).toBe('1');
  });

  it('keeps the page when one endpoint fails', async () => {
    fail.add('/v1/receivables/aging/');
    renderHome();
    expect(await screen.findByText('Call supplier')).toBeTruthy();
    expect(await within(screen.getByTestId('biz-aging')).findByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('biz-top-customers')).toBeTruthy();
    expect(screen.getAllByTestId('biz-kpi')).toHaveLength(4);
  });

  it('shows the checklist while incomplete and hides it when complete', async () => {
    const { unmount } = renderHome();
    expect(await screen.findByTestId('biz-checklist')).toBeTruthy();
    unmount();
    routes['/v1/contacts/'] = { items: [{}], total: 5, offset: 0, limit: 1 };
    routes['/v1/banking/accounts/'] = [{ id: 'a', name: 'Main', gl_account_code: '1200', currency: 'EUR', iban: '', bic: '', active: true }];
    routes['/v1/gl/reports/balance-sheet/'] = { asset: { accounts: [{ account_id: 'x', code: '1200', name: 'Bank', balance: '777' }], total: '777' } };
    renderHome();
    expect(await screen.findByText(/777/)).toBeTruthy();
    expect(screen.queryByTestId('biz-checklist')).toBeNull();
  });

  it('ranks top customers of the month from the summary', async () => {
    (routes['/v1/sales/summary/'] as Record<string, unknown>).top_customers = [
      { customer_id: 'c1', customer_name: 'Star Client', revenue: '900.00', invoices: 2 },
    ];
    renderHome();
    expect(await within(screen.getByTestId('biz-top-customers')).findByText('Star Client')).toBeTruthy();
  });

  it('links aging bands to filtered receivables', async () => {
    routes['/v1/receivables/aging/'] = { as_of: today, rows: [], totals: { current: '100', d1_30: '50', d31_60: '0', d61_90: '0', d90_plus: '0', total: '150' } };
    renderHome();
    const band = await screen.findByTestId('biz-aging-d1_30');
    expect(band.getAttribute('href')).toBe('/receivables?bucket=d1_30');
  });

  it('hides a card and remembers it', async () => {
    const { unmount } = renderHome();
    await screen.findByTestId('biz-activity');
    fireEvent.click(screen.getByText('Customize'));
    fireEvent.click(within(screen.getByTestId('biz-activity')).getByLabelText('Hide card'));
    fireEvent.click(screen.getByText('Done'));
    expect(screen.queryByTestId('biz-activity')).toBeNull();
    unmount();
    renderHome();
    await screen.findByTestId('biz-today');
    expect(screen.queryByTestId('biz-activity')).toBeNull();
  });

  it('uses no construction wording', async () => {
    renderHome();
    await screen.findByText('Call supplier');
    expect(document.body.textContent).not.toMatch(/project|BOQ|construction|site diary|estimate/i);
  });
});
