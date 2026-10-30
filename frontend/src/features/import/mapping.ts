/** Pure helpers for the import wizard's mapping step and error export. */

export type Mapping = Record<string, string>;

export interface FieldLike {
  key: string;
  label: string;
  required: boolean;
}

/** Lower-case, strip accents and punctuation: "USt-IdNr." -> "ustidnr". */
export function normalizeHeader(h: string): string {
  return (h ?? '')
    .normalize('NFKD')
    .replace(/ß/g, 'ss')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^0-9a-zа-яё]/g, '');
}

/** Apply a preset (header label -> field) to the file's headers, matching headers loosely. */
export function applyPreset(headers: string[], preset: Mapping, base: Mapping = {}): Mapping {
  const byNorm = new Map(Object.entries(preset).map(([h, f]) => [normalizeHeader(h), f]));
  const out: Mapping = { ...base };
  for (const h of headers) {
    const f = byNorm.get(normalizeHeader(h));
    if (f) {
      for (const k of Object.keys(out)) if (out[k] === f) delete out[k];
      out[h] = f;
    }
  }
  return out;
}

/** Assign one header to a field; a field is used by at most one header. Empty field clears. */
export function setColumn(mapping: Mapping, header: string, field: string): Mapping {
  const out: Mapping = {};
  for (const [h, f] of Object.entries(mapping)) {
    if (h !== header && f !== field) out[h] = f;
  }
  if (field) out[header] = field;
  return out;
}

export function missingRequired(fields: FieldLike[], mapping: Mapping): FieldLike[] {
  const used = new Set(Object.values(mapping));
  return fields.filter((f) => f.required && !used.has(f.key));
}

/** Opening balances need either Debit/Credit or Balance mapped. */
export function missingAmount(target: string, mapping: Mapping): boolean {
  if (target !== 'opening_balances') return false;
  const used = new Set(Object.values(mapping));
  return !used.has('debit') && !used.has('credit') && !used.has('balance');
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Row errors as a semicolon CSV with BOM, so Excel opens umlauts and Cyrillic correctly. */
export function errorsToCsv(errors: { row: number; message: string }[], headers = ['Row', 'Error']): string {
  const lines = [headers.map(csvCell).join(';'), ...errors.map((e) => [e.row || '', e.message].map(csvCell).join(';'))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}
