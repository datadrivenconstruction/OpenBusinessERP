import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BusinessSettingsHub } from './BusinessSettingsHub';

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock('@/shared/lib/api', () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPut: (...a: unknown[]) => apiPut(...a),
  getErrorMessage: (e: unknown) => String(e),
}));

const SETTINGS = {
  company_name: 'Muster GmbH', address: '', email: '', phone: '', website: '', vat_id: 'DE1', tax_number: '',
  iban: '', bic: '', bank_name: '', register_court: '', register_number: '', managing_directors: '', footer_text: '',
  payment_terms_days: 14, payment_terms_text: '', giro_code: true, logo_data_url: '', document_texts: {},
  tax_rates: [], base_currency: 'EUR', country_code: 'DE', fiscal_year_start_month: 1,
};

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><BusinessSettingsHub canEdit /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BusinessSettingsHub', () => {
  beforeEach(() => {
    apiGet.mockReset().mockImplementation((path: string) =>
      Promise.resolve(path.includes('numbering')
        ? [{ area: 'sales', kind: 'invoice', prefix: 'INV', last_number: 2, next_number: 'INV-000003' }]
        : SETTINGS));
    apiPut.mockReset().mockImplementation((_p, body) => Promise.resolve(body));
  });

  it('shows all sections, numbering and saves a tax rate', async () => {
    renderIt();
    expect(await screen.findByText('INV-000003')).toBeTruthy();
    expect(screen.getByTestId('hub-people')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /add tax rate/i }));
    fireEvent.change(screen.getByLabelText('Rate name'), { target: { value: 'Standard' } });
    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '19' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(apiPut.mock.calls[0]![1].tax_rates).toEqual([{ name: 'Standard', rate: 19, default: true }]);
  });

  it('search filters sections and shows an empty state', async () => {
    renderIt();
    await screen.findByText('INV-000003');
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'numbering' } });
    expect(screen.queryByTestId('business-documents-settings')).toBeNull();
    expect(screen.getByTestId('numbering-section')).toBeTruthy();
    fireEvent.change(box, { target: { value: 'zzzz' } });
    expect(screen.getByTestId('hub-empty')).toBeTruthy();
  });
});
