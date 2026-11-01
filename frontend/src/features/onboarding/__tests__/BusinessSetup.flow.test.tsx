// Business setup: every step saves progress server-side, steps can be skipped,
// and the last step creates, previews and issues the first invoice.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('@/shared/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/shared/lib/api')>('@/shared/lib/api');
  return { ...actual, ...api };
});
vi.mock('@/features/settings/MailSettings', () => ({ MailSettingsSection: () => <div>smtp-card</div> }));
vi.mock('@/features/sales/api', () => ({ fetchSalesPdf: vi.fn().mockResolvedValue(new Blob(['%PDF'])) }));
vi.mock('@/features/business-demo/api', () => ({
  fetchBusinessDemoCases: vi.fn().mockResolvedValue([{ key: 'trade', installed: false }]),
  installBusinessDemoCase: vi.fn().mockResolvedValue({}),
}));

import { BusinessSetup, SetupChecklist, suggestedChart } from '../BusinessSetup';
import { installBusinessDemoCase } from '@/features/business-demo/api';

const base = {
  company_name: '', address: '', country_code: 'DE', base_currency: 'EUR', vat_id: '', iban: '', bic: '',
  bank_name: '', payment_terms_days: 14, invoice_prefix: '', small_business: false, logo_data_url: '',
  tax_rates: [], setup: {},
};
let stored: Record<string, unknown>;

function renderAt(path = '/setup') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/setup" element={<BusinessSetup />} />
          <Route path="/dashboard" element={<div>dashboard<SetupChecklist /></div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  stored = { ...base };
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:pdf');
  globalThis.URL.revokeObjectURL = vi.fn();
  api.apiGet.mockImplementation(async (url: string) => (url.includes('fiscal-years') ? [] : stored));
  api.apiPut.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
    stored = { ...stored, ...body };
    return stored;
  });
  api.apiPost.mockImplementation(async (url: string) => {
    if (url === '/v1/contacts/') return { id: 'c1' };
    if (url === '/v1/sales/invoices/') return { id: 'i1', number: null, status: 'draft' };
    if (url.endsWith('/issue/')) return { id: 'i1', number: 'RE-000001', status: 'issued' };
    return {};
  });
});

describe('BusinessSetup', () => {
  it('suggests SKR03 for Germany and IFRS elsewhere', () => {
    expect(suggestedChart('DE')).toBe('de_skr03');
    expect(suggestedChart('FR')).toBe('ifrs_generic');
  });

  it('walks every step, skipping mail, and issues the first invoice', async () => {
    renderAt();
    fireEvent.change(await screen.findByTestId('setup-company-name'), { target: { value: 'Acme GmbH' } });
    fireEvent.click(screen.getByTestId('setup-next'));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/v1/gl/templates/de_skr03/load/', {}));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/v1/gl/fiscal-years/', expect.objectContaining({ start_date: expect.stringMatching(/-01-01$/) })));
    await waitFor(() => expect(stored.company_name).toBe('Acme GmbH'));

    fireEvent.click(await screen.findByTestId('setup-small-business'));
    fireEvent.click(screen.getByTestId('setup-next'));
    await waitFor(() => expect(stored.small_business).toBe(true));

    fireEvent.change(await screen.findByTestId('setup-iban'), { target: { value: 'DE89 3704 0044 0532 0130 00' } });
    fireEvent.click(screen.getByTestId('setup-next'));
    await waitFor(() =>
      expect(api.apiPost).toHaveBeenCalledWith('/v1/banking/accounts/', expect.objectContaining({ iban: 'DE89370400440532013000' })),
    );

    fireEvent.change(await screen.findByTestId('setup-prefix'), { target: { value: 're' } });
    fireEvent.click(screen.getByTestId('setup-next'));
    await waitFor(() => expect(stored.invoice_prefix).toBe('RE'));

    await screen.findByText('smtp-card');
    fireEvent.click(screen.getByTestId('setup-skip'));

    fireEvent.click(await screen.findByTestId('setup-preview'));
    fireEvent.click(await screen.findByTestId('setup-issue'));
    expect(await screen.findByTestId('setup-issued')).toHaveTextContent('RE-000001');
    const draft = api.apiPost.mock.calls.find(([u]) => u === '/v1/sales/invoices/')![1];
    expect(draft.lines.every((l: { tax_rate: number }) => l.tax_rate === 0)).toBe(true);

    fireEvent.click(screen.getByTestId('setup-next'));
    await screen.findByText('dashboard');
    expect(stored.setup).toMatchObject({ finished: true, skipped: ['mail'] });
    expect(await screen.findByTestId('setup-checklist')).toHaveTextContent('5 of 6 done');
  });

  it('resumes at the saved step', async () => {
    stored = { ...base, setup: { step: 3, done: ['company', 'tax', 'bank'], skipped: [] } };
    renderAt();
    expect(await screen.findByTestId('setup-prefix')).toBeInTheDocument();
  });

  it('loads a demo company instead', async () => {
    renderAt();
    fireEvent.click(await screen.findByTestId('setup-load-demo'));
    await screen.findByText('dashboard');
    expect(installBusinessDemoCase).toHaveBeenCalledWith('trade');
  });
});
