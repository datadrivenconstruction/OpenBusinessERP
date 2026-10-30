import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BusinessDocumentsSettings } from './BusinessDocumentsSettings';

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock('@/shared/lib/api', () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPut: (...a: unknown[]) => apiPut(...a),
  getErrorMessage: (e: unknown) => String(e),
}));

const SETTINGS = {
  company_name: 'Muster GmbH', address: 'Str 1', email: '', phone: '', website: '', vat_id: 'DE1', tax_number: '',
  iban: '', bic: '', bank_name: '', register_court: '', register_number: '', managing_directors: '', footer_text: '',
  payment_terms_days: 14, payment_terms_text: '', giro_code: true, logo_data_url: '', document_texts: {},
};

function renderIt(canEdit = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BusinessDocumentsSettings canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

describe('BusinessDocumentsSettings', () => {
  beforeEach(() => {
    apiGet.mockReset().mockResolvedValue(SETTINGS);
    apiPut.mockReset().mockImplementation((_p, body) => Promise.resolve(body));
  });

  it('saves edited legal data and per-kind default texts', async () => {
    renderIt();
    const vat = await screen.findByDisplayValue('DE1');
    fireEvent.change(vat, { target: { value: 'DE999' } });
    fireEvent.change(screen.getByText('Opening text').querySelector('textarea')!, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    const body = apiPut.mock.calls[0]![1];
    expect(body.vat_id).toBe('DE999');
    expect(body.document_texts.invoice.intro).toBe('Hello');
  });

  it('is read-only without edit rights', async () => {
    renderIt(false);
    expect(await screen.findByDisplayValue('DE1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });
});
