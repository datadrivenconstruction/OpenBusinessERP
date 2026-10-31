/** Workflow actions available for a document in its current status. */
import type { DocKind } from '../api';

export type DocAction =
  | { key: string; label: string; type: 'status'; status: string; primary?: boolean; danger?: boolean }
  | { key: string; label: string; type: 'convert' | 'issue' | 'credit_note'; primary?: boolean; danger?: boolean };

export function docActions(kind: DocKind, status: string): DocAction[] {
  const out: DocAction[] = [];
  const st = (key: string, label: string, s: string, primary = false, danger = false) =>
    out.push({ key, label, type: 'status', status: s, primary, danger });
  if (kind === 'quote') {
    if (status === 'draft') st('send', 'Mark sent', 'sent');
    if (status === 'sent') {
      st('accept', 'Accepted', 'accepted');
      st('reject', 'Rejected', 'rejected');
    }
    if (['sent', 'accepted'].includes(status)) out.push({ key: 'to_order', label: 'Convert to order', type: 'convert', primary: true });
  }
  if (kind === 'order') {
    if (status === 'draft') st('confirm', 'Confirm', 'confirmed', true);
    if (status === 'confirmed') st('deliver', 'Mark delivered', 'delivered');
    if (['confirmed', 'delivered'].includes(status)) out.push({ key: 'to_invoice', label: 'Create invoice', type: 'convert', primary: true });
  }
  if (kind === 'invoice' && status === 'draft') out.push({ key: 'issue', label: 'Issue & post', type: 'issue', primary: true });
  if (kind === 'invoice' && ['issued', 'partially_paid', 'paid'].includes(status))
    out.push({ key: 'credit_note', label: 'Create credit note', type: 'credit_note' });
  if (kind === 'credit_note' && status === 'draft') st('issue_cn', 'Issue', 'issued', true);
  if (['draft', 'sent', 'confirmed'].includes(status) || (kind === 'invoice' && status === 'issued') || (kind === 'order' && status === 'delivered'))
    st('cancel', 'Cancel document', 'cancelled', false, true);
  return out;
}
