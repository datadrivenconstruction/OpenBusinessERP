import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SalesTable } from './SalesTable';
import type { SalesDocSummary } from '../api';

const ROW = {
  id: 'i1', kind: 'invoice', number: 'INV-000007', status: 'issued', customer_id: null, customer_name: 'Acme Build',
  currency: 'EUR', doc_date: '2026-01-02', due_date: '2026-01-10', net_total: '100', tax_total: '19', gross_total: '119',
  amount_paid: '0', source_id: null, gl_entry_id: null, is_overdue: true, balance_due: '119',
} as SalesDocSummary;

describe('SalesTable', () => {
  it('renders rows with overdue flag, sorts and selects', () => {
    const onSort = vi.fn();
    const onToggle = vi.fn();
    const noop = vi.fn();
    render(
      <MemoryRouter>
        <SalesTable
          kind="invoices"
          rows={[ROW]}
          sort="-doc_date"
          onSort={onSort}
          selected={new Set()}
          onToggle={onToggle}
          onToggleAll={noop}
          actions={{ pdf: noop, send: noop, duplicate: noop, convert: noop, pay: noop }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('INV-000007')).toBeInTheDocument();
    expect(screen.getByText('AB')).toBeInTheDocument();
    expect(screen.getByText('overdue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^date/i }));
    expect(onSort).toHaveBeenCalledWith('doc_date');
    fireEvent.click(screen.getByRole('checkbox', { name: /select inv-000007/i }));
    expect(onToggle).toHaveBeenCalledWith('i1');
    fireEvent.click(screen.getByRole('button', { name: /actions for/i }));
    expect(screen.getByRole('menuitem', { name: /record payment/i })).toBeInTheDocument();
  });
});
