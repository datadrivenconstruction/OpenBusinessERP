import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SalesDocumentOutput, splitAddresses } from './SalesDocumentOutput';
import { kindPath, type SalesDoc } from './api';

vi.mock('./api', async (orig) => {
  const real = await orig<typeof import('./api')>();
  return {
    ...real,
    salesApi: {
      check: vi.fn().mockResolvedValue([{ field: 'delivery_date', message: 'Delivery date or service period is missing.' }]),
      sends: vi.fn().mockResolvedValue([
        { id: '1', sent_by: 'u', sent_at: '2026-03-10T10:00:00Z', to_addr: 'buyer@example.com', cc: [], subject: 's', status: 'sent', detail: '', backend: 'console' },
      ]),
    },
  };
});

const DOC = { id: 'd1', kind: 'invoice', number: 'INV-000001', status: 'draft' } as SalesDoc;

describe('SalesDocumentOutput', () => {
  it('shows the invoice check and the send history', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SalesDocumentOutput doc={DOC} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument();
    expect(await screen.findByText('Delivery date or service period is missing.')).toBeInTheDocument();
    expect(await screen.findByText(/buyer@example.com/)).toBeInTheDocument();
  });

  it('maps kinds to paths and splits cc lists', () => {
    expect(kindPath('credit_note')).toBe('credit-notes');
    expect(splitAddresses('a@x.de, b@y.de; c@z.de')).toEqual(['a@x.de', 'b@y.de', 'c@z.de']);
  });
});
