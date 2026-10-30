/** API helpers for the data import wizard, backed by /api/v1/data-import/. */

import {
  API_BASE,
  apiDelete,
  apiGet,
  apiPost,
  downloadWithAuth,
  extractErrorMessageFromBody,
  fetchWithAuth,
} from '@/shared/lib/api';

export type TargetKey = 'customers' | 'suppliers' | 'items' | 'opening_balances' | 'open_invoices' | 'open_bills';

export interface TargetField {
  key: string;
  label: string;
  kind: string;
  required: boolean;
}

export interface ImportTarget {
  key: TargetKey;
  label: string;
  fields: TargetField[];
}

export interface ImportSummary {
  create?: number;
  update?: number;
  skip?: number;
  error?: number;
  total?: number;
  ok?: boolean;
  file_errors?: string[];
  warnings?: string[];
  confidence?: Record<string, number>;
  undone_removed?: number;
  undone_kept_updates?: number;
}

export interface ImportJob {
  id: string;
  target: TargetKey;
  filename: string;
  status: 'uploaded' | 'validated' | 'committed' | 'undone';
  encoding: string;
  delimiter: string;
  headers: string[];
  mapping: Record<string, string>;
  options: Record<string, unknown>;
  summary: ImportSummary;
  row_count: number;
  created_at: string | null;
  preview?: string[][];
}

export interface RowError {
  row: number;
  message: string;
}

export interface ValidationResult {
  summary: ImportSummary;
  errors: RowError[];
}

export interface MappingPreset {
  id: string | null;
  name: string;
  mapping: Record<string, string>;
  builtin: boolean;
}

export type Mapping = Record<string, string>;
export type ImportOptions = { skip_invalid?: boolean; opening_date?: string; existing?: 'update' | 'skip' };

const B = '/v1/data-import';

async function upload(target: TargetKey, file: File): Promise<ImportJob> {
  const body = new FormData();
  body.append('target', target);
  body.append('file', file);
  const res = await fetchWithAuth(`${API_BASE}${B}/jobs/`, { method: 'POST', body });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(extractErrorMessageFromBody(data) ?? `Upload failed (HTTP ${res.status})`);
  return data as ImportJob;
}

export const importApi = {
  targets: () => apiGet<ImportTarget[]>(`${B}/targets/`),
  jobs: () => apiGet<ImportJob[]>(`${B}/jobs/`),
  upload,
  validate: (id: string, mapping: Mapping, options: ImportOptions) =>
    apiPost<ValidationResult>(`${B}/jobs/${id}/validate/`, { mapping, options }),
  commit: (id: string, mapping: Mapping, options: ImportOptions) =>
    apiPost<{ summary: ImportSummary; job_id: string }>(`${B}/jobs/${id}/commit/`, { mapping, options }),
  undo: (id: string) => apiPost<{ removed: number; kept_updates: number }>(`${B}/jobs/${id}/undo/`, {}),
  presets: (target: TargetKey) => apiGet<MappingPreset[]>(`${B}/presets/${target}/`),
  savePreset: (target: TargetKey, name: string, mapping: Mapping) =>
    apiPost<MappingPreset>(`${B}/presets/${target}/`, { name, mapping }),
  deletePreset: (id: string) => apiDelete(`${B}/presets/item/${id}/`),
  template: (target: TargetKey) =>
    downloadWithAuth(`${API_BASE}${B}/templates/${target}.csv`, `import-${target}-template.csv`),
};
