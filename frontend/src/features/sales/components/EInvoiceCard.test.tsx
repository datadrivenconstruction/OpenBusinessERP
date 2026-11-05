import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EInvoiceCard, canExportEInvoice } from './EInvoiceCard';
import type { SalesDoc } from '../api';

vi.mock('@/features/finance/EInvoiceModal', () => ({
  EInvoiceModal: (p: { invoiceId: string; invoiceNumber: string; basePath?: string }) => (
    <div data-testid="modal">{`${p.basePath}/${p.invoiceId}/${p.invoiceNumber}`}</div>
  ),
}));

const doc = (over: Partial<SalesDoc>) => ({ id: 'd1', kind: 'invoice', number: 'INV-000001', status: 'issued', ...over }) as SalesDoc;

describe('EInvoiceCard', () => {
  it.each(['issued', 'partially_paid', 'paid'])('offers the export on a %s invoice', (status) => {
    render(<EInvoiceCard doc={doc({ status })} />);
    expect(screen.getByRole('button', { name: 'Export e-invoice' })).toBeInTheDocument();
  });

  it.each([
    ['draft invoice', doc({ status: 'draft' })],
    ['cancelled invoice', doc({ status: 'cancelled' })],
    ['issued quote', doc({ kind: 'quote' })],
    ['issued credit note', doc({ kind: 'credit_note' })],
  ])('hides the export on an %s', (_name, d) => {
    const { container } = render(<EInvoiceCard doc={d} />);
    expect(container).toBeEmptyDOMElement();
    expect(canExportEInvoice(d)).toBe(false);
  });

  it('opens the modal against the sales endpoint with the invoice preselected', () => {
    render(<EInvoiceCard doc={doc({})} />);
    expect(screen.queryByTestId('modal')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export e-invoice' }));
    expect(screen.getByTestId('modal')).toHaveTextContent('/api/v1/sales/invoices/d1/INV-000001');
  });
});
