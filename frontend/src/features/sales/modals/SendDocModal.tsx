import { kindPath, type SalesDocSummary } from '../api';
import { useSalesDoc } from '../hooks';
import { SendDialog } from '../SalesDocumentOutput';

/** Opens the e-mail dialog for a list row once its full document has loaded. */
export function SendDocModal({ doc, onClose }: { doc: SalesDocSummary; onClose: () => void }) {
  const full = useSalesDoc(kindPath(doc.kind), doc.id);
  return full.data ? <SendDialog doc={full.data} onClose={onClose} /> : null;
}
