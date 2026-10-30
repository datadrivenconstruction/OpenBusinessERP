/** Client-side CSV of the selected / visible list (RFC 4180 quoting). */
import type { SalesDocSummary } from '../api';
import { balanceDue } from './totals';

export function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function salesDocsCsv(docs: SalesDocSummary[]): string {
  return toCsv(
    ['number', 'date', 'due_date', 'customer', 'status', 'currency', 'net', 'tax', 'gross', 'paid', 'balance_due'],
    docs.map((d) => [
      d.number, d.doc_date, d.due_date ?? '', d.customer_name, d.status, d.currency,
      d.net_total, d.tax_total, d.gross_total, d.amount_paid, balanceDue(d).toFixed(2),
    ]),
  );
}
