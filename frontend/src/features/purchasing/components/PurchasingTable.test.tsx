import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PurchasingTable } from './PurchasingTable';
import { StatusTimeline } from './StatusTimeline';
import type { PurchasingDocSummary } from '../api';

const row: PurchasingDocSummary = {
  id: 'b1', number: 'BILL-7', status: 'posted', supplier_id: 's', supplier_name: 'Nordic Timber', currency: 'EUR',
  doc_date: '2026-01-01', due_date: '2020-01-01', net_total: '100', tax_total: '19', gross_total: '119',
  balance_due: '119', is_overdue: true, match_status: 'matched', kind: 'bill',
};

describe('PurchasingTable', () => {
  it('renders rows, sorts, selects and opens the row menu', () => {
    const onSort = vi.fn();
    const onToggle = vi.fn();
    const onAction = vi.fn();
    render(
      <MemoryRouter>
        <PurchasingTable isOrder={false} rows={[row]} sort="-doc_date" onSort={onSort} selected={new Set()} onToggle={onToggle} onToggleAll={() => {}} onAction={onAction} />
      </MemoryRouter>,
    );
    expect(screen.getByText('BILL-7')).toBeInTheDocument();
    expect(screen.getByText('NT')).toBeInTheDocument();
    expect(screen.getByText('overdue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Due/ }));
    expect(onSort).toHaveBeenCalledWith('due_date');
    fireEvent.click(screen.getByLabelText('BILL-7'));
    expect(onToggle).toHaveBeenCalledWith('b1');
    fireEvent.click(screen.getByRole('button', { name: /Actions for/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Record payment/i }));
    expect(onAction).toHaveBeenCalledWith('pay', row);
  });

  it('timeline marks step states', () => {
    const { container } = render(<StatusTimeline steps={{ ordered: 'done', received: 'partial', billed: 'todo', paid: 'skipped' }} />);
    expect(container.querySelectorAll('[data-state="done"]').length).toBe(1);
    expect(screen.getByText('Received')).toBeInTheDocument();
  });
});
