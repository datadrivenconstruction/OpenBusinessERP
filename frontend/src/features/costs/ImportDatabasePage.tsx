// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { useState, useCallback, useRef, type DragEvent, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Database,
  Download,
  BookOpen,
} from 'lucide-react';
import { Button, Card, Badge, Breadcrumb, DismissibleInfo, IntroRichText } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { useToastStore } from '@/stores/useToastStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { extractErrorMessageFromBody } from '@/shared/lib/api';
import { fmtList, formatFileSize } from '@/shared/lib/formatters';
import { COMMON_CURRENCIES } from '@/features/boq/boqHelpers';
import { fetchCostCatalogs, type CostCatalog } from './api';
import { ResourcePriceSheetPanel } from './ResourcePriceSheetPanel';
import { RegionalPriceListImport } from './RegionalPriceListImport';

// ── Types ────────────────────────────────────────────────────────────────────

interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{
    row: number;
    error: string;
    data: Record<string, string>;
  }>;
  total_rows: number;
  catalog?: string | null;
  /** Target catalog the rows landed in (existing or created inline). */
  catalog_id?: string | null;
  /** Currency of the target catalog - the default for rows without one. */
  catalog_currency?: string | null;
  /** Rows whose own currency differs from the catalog currency. Imported
   *  as-is (never silently rewritten) - a warning, not a block. */
  mixed_currency_count?: number;
}

// Result of the column-mapping preview endpoint. Drives the mapping panel:
// the user maps each canonical target field to one of the raw file headers
// before committing the import.
interface PreviewResult {
  headers: string[];
  sample_rows: string[][];
  suggested_map: Record<string, string>;
  target_fields: string[];
  required_fields: string[];
  /** Whether the auto-detected mapping found a currency column. When false,
   *  creating a NEW catalog requires an explicit catalog currency. */
  has_currency_column?: boolean;
}

// Sentinel used by the per-field <select> to mean "this canonical field has
// no source column". Kept out of the submitted column_map.
const NOT_MAPPED = '';

// The three template download links. They are anchors, not buttons, so they
// cannot go through <Button> - this borrows its secondary variant instead
// (same radius, border, shadow lift and focus ring) so the tertiary row on
// this page speaks the same language as every other control.
// The border token here used to read `border-border-default`, which is not a
// key in the palette: Tailwind emitted nothing for it and the links fell back
// to the preflight grey in both themes.
const TEMPLATE_LINK_CLASS =
  'inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-primary px-3 py-1.5 ' +
  'text-xs font-medium text-content-secondary shadow-xs ' +
  'transition-all duration-normal ease-oe ' +
  'hover:bg-surface-secondary hover:text-oe-blue hover:shadow-sm active:scale-[0.98] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oe-blue';


// ── API helper for file upload ───────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Ask the backend to inspect the uploaded file: it returns the raw headers, a
 * few sample rows and a suggested canonical-field -> header mapping. Used to
 * drive the column-mapping panel before the actual import.
 */
async function previewCostFile(file: File): Promise<PreviewResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/v1/costs/import/preview/', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!response.ok) {
    let detail = 'Preview failed';
    try {
      const body = await response.json();
      detail = extractErrorMessageFromBody(body) ?? detail;
    } catch {
      // ignore parse error
    }
    throw new Error(detail);
  }

  return response.json() as Promise<PreviewResult>;
}

/** Target-catalog options for `uploadCostFile`. Pass `catalogId` to import
 *  into an EXISTING catalog, or `catalogName` (+ `catalogCurrency` when the
 *  file has no mapped currency column) to create one inline. Mutually
 *  exclusive - the backend rejects both at once. */
interface UploadCostFileOptions {
  columnMap?: Record<string, string>;
  catalogId?: string;
  catalogName?: string;
  catalogCurrency?: string;
}

/**
 * Import a cost file. When `columnMap` is supplied it is sent as a JSON
 * `column_map` (canonical field -> raw header) so the backend uses the user's
 * explicit mapping instead of re-guessing. The catalog options route the
 * imported rows into a user catalog. Everything is optional so the legacy
 * auto-detect path (no map, no catalog) keeps working as a fallback.
 */
async function uploadCostFile(
  file: File,
  options: UploadCostFileOptions = {},
): Promise<ImportResult> {
  const { columnMap, catalogId, catalogName, catalogCurrency } = options;
  const formData = new FormData();
  formData.append('file', file);
  if (columnMap && Object.keys(columnMap).length > 0) {
    formData.append('column_map', JSON.stringify(columnMap));
  }
  if (catalogId) {
    formData.append('catalog_id', catalogId);
  } else if (catalogName && catalogName.trim()) {
    formData.append('catalog_name', catalogName.trim());
    if (catalogCurrency && catalogCurrency.trim()) {
      formData.append('catalog_currency', catalogCurrency.trim().toUpperCase());
    }
  }

  const response = await fetch('/api/v1/costs/import/file/', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!response.ok) {
    let detail = 'Upload failed';
    try {
      const body = await response.json();
      detail = extractErrorMessageFromBody(body) ?? detail;
    } catch {
      // ignore parse error
    }
    throw new Error(detail);
  }

  return response.json() as Promise<ImportResult>;
}

// Human-readable label + helper text per canonical target field, all i18n.
// Used by the mapping panel rows.
function useTargetFieldMeta() {
  const { t } = useTranslation();
  return (field: string): { label: string; hint: string } => {
    switch (field) {
      case 'code':
        return {
          label: t('costs_import.field_code', { defaultValue: 'Code' }),
          hint: t('costs_import.field_code_hint', { defaultValue: 'Item / position number' }),
        };
      case 'description':
        return {
          label: t('costs_import.field_description', { defaultValue: 'Description' }),
          hint: t('costs_import.field_description_hint', { defaultValue: 'What the cost item is' }),
        };
      case 'unit':
        return {
          label: t('costs_import.field_unit', { defaultValue: 'Unit' }),
          hint: t('costs_import.field_unit_hint', { defaultValue: 'm, m2, m3, pcs, h ...' }),
        };
      case 'rate':
        return {
          label: t('costs_import.field_rate', { defaultValue: 'Rate' }),
          hint: t('costs_import.field_rate_hint', { defaultValue: 'Unit price / cost' }),
        };
      case 'currency':
        return {
          label: t('costs_import.field_currency', { defaultValue: 'Currency' }),
          hint: t('costs_import.field_currency_hint', { defaultValue: 'EUR, USD, GBP ...' }),
        };
      case 'classification':
        return {
          label: t('costs_import.field_classification', { defaultValue: 'Classification' }),
          hint: t('costs_import.field_classification_hint', {
            defaultValue: 'DIN 276 / NRM / MasterFormat code',
          }),
        };
      default:
        return { label: field, hint: '' };
    }
  };
}

// ── File Preview Info ────────────────────────────────────────────────────────

interface FilePreview {
  name: string;
  size: string;
  type: 'excel' | 'csv';
}

// `formatFileSize` lives in `@/shared/lib/formatters` — same implementation,
// shared with the AI and Takeoff surfaces. Imported above.

function getFileType(name: string): 'excel' | 'csv' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'excel';
  if (lower.endsWith('.csv')) return 'csv';
  return null;
}

// ── Busy label ───────────────────────────────────────────────────────────────

/** Stacks the resting and busy labels of an action button in one grid cell so
 *  the button is always as wide as the longer of the two. Swapping the text in
 *  place resizes the button the instant an import starts, which drags the row
 *  it sits in sideways - and the widths differ per language, so no fixed width
 *  would hold. `invisible` is visibility:hidden, which also keeps the label
 *  that is not showing out of the accessibility tree. */
function BusyLabel({ idle, busy, isBusy }: { idle: string; busy: string; isBusy: boolean }) {
  return (
    <span className="grid justify-items-center">
      <span className={`col-start-1 row-start-1 ${isBusy ? 'invisible' : ''}`}>{idle}</span>
      <span className={`col-start-1 row-start-1 ${isBusy ? '' : 'invisible'}`}>{busy}</span>
    </span>
  );
}

// ── Column Mapping Panel ─────────────────────────────────────────────────────

type CatalogTargetMode = 'new' | 'existing';

interface ColumnMappingPanelProps {
  data: PreviewResult;
  columnMap: Record<string, string>;
  onChangeField: (field: string, header: string) => void;
  catalogMode: CatalogTargetMode;
  onCatalogModeChange: (mode: CatalogTargetMode) => void;
  catalogName: string;
  onCatalogNameChange: (value: string) => void;
  catalogCurrency: string;
  onCatalogCurrencyChange: (value: string) => void;
  existingCatalogId: string;
  onExistingCatalogChange: (id: string) => void;
  /** User catalogs for the "existing catalog" dropdown. */
  catalogs: CostCatalog[];
  onImport: () => void;
  onCancel: () => void;
  importing: boolean;
}

function ColumnMappingPanel({
  data,
  columnMap,
  onChangeField,
  catalogMode,
  onCatalogModeChange,
  catalogName,
  onCatalogNameChange,
  catalogCurrency,
  onCatalogCurrencyChange,
  existingCatalogId,
  onExistingCatalogChange,
  catalogs,
  onImport,
  onCancel,
  importing,
}: ColumnMappingPanelProps) {
  const { t } = useTranslation();
  const fieldMeta = useTargetFieldMeta();

  const requiredFields = data.required_fields.length > 0 ? data.required_fields : ['description'];
  const isRequired = (field: string) => requiredFields.includes(field);

  // All required fields must be mapped before import is allowed.
  const unmappedRequired = requiredFields.filter((f) => !columnMap[f]);

  // Currency presence tracks the LIVE mapping (the seeded map mirrors the
  // preview's auto-detection, and the user may map / unmap the column
  // here). When the file carries no mapped currency column, a NEW catalog
  // needs an explicit currency - same rule the backend enforces with 422.
  const hasCurrencyColumn = Boolean(columnMap['currency']);
  const newCatalogCurrencyMissing =
    catalogMode === 'new' && !hasCurrencyColumn && !catalogCurrency;
  const catalogTargetValid =
    catalogMode === 'existing'
      ? Boolean(existingCatalogId)
      : Boolean(catalogName.trim()) && !newCatalogCurrencyMissing;

  const canImport = unmappedRequired.length === 0 && catalogTargetValid && !importing;
  const selectedExisting = catalogs.find((c) => c.id === existingCatalogId);

  const modeOptionClass = (active: boolean) =>
    `flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
      active
        ? 'border-oe-blue/50 bg-oe-blue-subtle/15'
        : 'border-border-light hover:bg-surface-secondary/50'
    }`;

  // Show up to 3 sample rows under their headers.
  const sampleRows = data.sample_rows.slice(0, 3);

  // Selectable header options: drop empty-string headers (they would collide
  // with the not-mapped sentinel). Duplicate header names share the same
  // option VALUE, so the select cannot tell them apart - picking the second
  // occurrence would silently map the first. Keep only the FIRST occurrence
  // of each name (the one the backend's column_map resolves to anyway) and
  // surface a warning line under the mapping panel.
  const headerOptions: Array<{ header: string; index: number }> = [];
  const duplicateHeaders: string[] = [];
  const seenHeaders = new Set<string>();
  data.headers.forEach((header, index) => {
    if (header.trim() === '') return;
    if (seenHeaders.has(header)) {
      if (!duplicateHeaders.includes(header)) duplicateHeaders.push(header);
      return;
    }
    seenHeaders.add(header);
    headerOptions.push({ header, index });
  });

  return (
    <Card className="animate-card-in" padding="none">
      <div className="px-6 pt-5 pb-4">
        <div className="flex items-start gap-3 mb-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-oe-blue-subtle">
            <FileSpreadsheet size={18} className="text-oe-blue" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-content-primary">
              {t('costs_import.map_columns_title', { defaultValue: 'Map your columns' })}
            </h3>
            <p className="text-xs text-content-tertiary mt-0.5">
              {t('costs_import.map_columns_subtitle', {
                defaultValue:
                  'Tell us which column in your file holds each value. We pre-filled the ones we recognised.',
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Mapping rows */}
      <div className="px-6 pb-2">
        <div className="rounded-xl border border-border-light divide-y divide-border-light overflow-hidden">
          {data.target_fields.map((field) => {
            const meta = fieldMeta(field);
            const required = isRequired(field);
            const value = columnMap[field] ?? NOT_MAPPED;
            const missing = required && !value;
            return (
              <div
                key={field}
                className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 ${
                  missing ? 'bg-semantic-error-bg/20' : ''
                }`}
              >
                <div className="sm:w-1/3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-content-primary">{meta.label}</span>
                    {required && (
                      <Badge variant="neutral" size="sm" className="text-2xs px-1.5 py-0">
                        {t('costs_import.required', { defaultValue: 'required' })}
                      </Badge>
                    )}
                  </div>
                  {meta.hint && (
                    <p className="text-2xs text-content-tertiary mt-0.5">{meta.hint}</p>
                  )}
                </div>
                <div className="flex-1">
                  <select
                    value={value}
                    onChange={(e) => onChangeField(field, e.target.value)}
                    aria-label={meta.label}
                    className={`w-full rounded-lg border bg-surface-elevated px-3 py-2 text-sm text-content-primary focus:outline-none focus:border-oe-blue/50 transition-colors ${
                      missing ? 'border-semantic-error/50' : 'border-border-light'
                    }`}
                  >
                    <option value={NOT_MAPPED}>
                      {t('costs_import.not_mapped', { defaultValue: 'Not mapped' })}
                    </option>
                    {headerOptions.map(({ header, index }) => (
                      <option key={`opt-${index}`} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                  {missing && (
                    <p className="text-2xs text-semantic-error mt-1">
                      {t('costs_import.field_required_hint', {
                        defaultValue: 'Map a column for this field to continue.',
                      })}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {duplicateHeaders.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {duplicateHeaders.map((name) => (
              <p key={name} className="text-2xs text-amber-700 dark:text-amber-400">
                {t('costs_import.duplicate_header', {
                  defaultValue:
                    'Duplicate column name "{{name}}" - only the first occurrence is used.',
                  name,
                })}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Sample preview table */}
      {sampleRows.length > 0 && (
        <div className="px-6 pt-3 pb-2">
          <p className="text-2xs font-medium uppercase tracking-wider text-content-tertiary mb-2">
            {t('costs_import.sample_preview', { defaultValue: 'Sample from your file' })}
          </p>
          <div className="rounded-xl border border-border-light overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-tertiary text-left">
                  {data.headers.map((header, ci) => (
                    <th
                      key={`head-${ci}`}
                      className="px-3 py-2 font-medium text-content-secondary whitespace-nowrap"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {sampleRows.map((row, ri) => (
                  <tr key={`sample-${ri}`} className="hover:bg-surface-secondary/40">
                    {data.headers.map((header, ci) => (
                      <td
                        key={`${header}-${ci}`}
                        className="px-3 py-2 text-content-secondary whitespace-nowrap max-w-[18rem] truncate"
                      >
                        {row[ci] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Target catalog step - the imported rows always land in a user
          catalog: a new one created inline, or an existing one. */}
      <div className="px-6 pt-3 pb-2">
        <p className="text-sm font-medium text-content-primary mb-1">
          {t('costs_catalogs.import_target_title', { defaultValue: 'Where should these items go?' })}
        </p>
        <p className="text-2xs text-content-tertiary mb-2">
          {t('costs_catalogs.import_target_hint', {
            defaultValue: 'Items are grouped into a catalog so you can manage and export them later.',
          })}
        </p>

        <div className="grid gap-2 sm:grid-cols-2 max-w-2xl">
          {/* New catalog */}
          <label className={modeOptionClass(catalogMode === 'new')}>
            <input
              type="radio"
              name="catalog-target-mode"
              checked={catalogMode === 'new'}
              onChange={() => onCatalogModeChange('new')}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-content-primary">
                {t('costs_catalogs.import_new_catalog', { defaultValue: 'Create a new catalog' })}
              </span>
              {catalogMode === 'new' && (
                <span className="block mt-2 space-y-2">
                  <input
                    id="catalog-name"
                    type="text"
                    value={catalogName}
                    onChange={(e) => onCatalogNameChange(e.target.value)}
                    placeholder={t('costs_import.catalog_name_placeholder', {
                      defaultValue: 'e.g. My price book 2026',
                    })}
                    aria-label={t('costs_import.catalog_name', { defaultValue: 'Catalog name' })}
                    className="w-full rounded-lg border border-border-light bg-surface-elevated px-3 py-2 text-sm text-content-primary placeholder:text-content-quaternary focus:outline-none focus:border-oe-blue/50 transition-colors"
                  />
                  <select
                    value={catalogCurrency}
                    onChange={(e) => onCatalogCurrencyChange(e.target.value)}
                    aria-label={t('costs_catalogs.currency_label', { defaultValue: 'Currency' })}
                    className={`w-full rounded-lg border bg-surface-elevated px-3 py-2 text-sm text-content-primary focus:outline-none focus:border-oe-blue/50 transition-colors ${
                      newCatalogCurrencyMissing
                        ? 'border-semantic-error/60 ring-1 ring-semantic-error/30'
                        : 'border-border-light'
                    }`}
                  >
                    <option value="">
                      {t('costs_catalogs.import_currency_select', { defaultValue: 'Select currency...' })}
                    </option>
                    {COMMON_CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {newCatalogCurrencyMissing ? (
                    <span className="block text-2xs text-semantic-error">
                      {t('costs_catalogs.import_currency_required', {
                        defaultValue:
                          'The file has no currency column, so the new catalog needs an explicit currency.',
                      })}
                    </span>
                  ) : (
                    <span className="block text-2xs text-content-tertiary">
                      {hasCurrencyColumn
                        ? t('costs_catalogs.import_currency_detected', {
                            defaultValue:
                              'Currency column detected. Leave empty to derive the catalog currency from the file.',
                          })
                        : t('costs_catalogs.currency_hint', {
                            defaultValue: 'Items without their own currency inherit this code.',
                          })}
                    </span>
                  )}
                </span>
              )}
            </span>
          </label>

          {/* Existing catalog */}
          <label className={modeOptionClass(catalogMode === 'existing')}>
            <input
              type="radio"
              name="catalog-target-mode"
              checked={catalogMode === 'existing'}
              onChange={() => onCatalogModeChange('existing')}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-content-primary">
                {t('costs_catalogs.import_existing_catalog', { defaultValue: 'Add to an existing catalog' })}
              </span>
              {catalogMode === 'existing' && (
                <span className="block mt-2 space-y-1.5">
                  {catalogs.length === 0 ? (
                    <span className="block text-2xs text-content-tertiary">
                      {t('costs_catalogs.import_existing_empty', {
                        defaultValue: 'No catalogs yet. Create a new one instead.',
                      })}
                    </span>
                  ) : (
                    <>
                      <select
                        value={existingCatalogId}
                        onChange={(e) => onExistingCatalogChange(e.target.value)}
                        aria-label={t('costs_catalogs.import_existing_catalog', { defaultValue: 'Add to an existing catalog' })}
                        className="w-full rounded-lg border border-border-light bg-surface-elevated px-3 py-2 text-sm text-content-primary focus:outline-none focus:border-oe-blue/50 transition-colors"
                      >
                        <option value="">
                          {t('costs_catalogs.import_existing_select', { defaultValue: 'Select a catalog...' })}
                        </option>
                        {catalogs.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.currency}, {c.item_count})
                          </option>
                        ))}
                      </select>
                      {selectedExisting && (
                        <span className="block text-2xs text-content-tertiary">
                          {t('costs_catalogs.import_into_named', {
                            defaultValue: 'Items will be imported into "{{name}}" ({{currency}}).',
                            name: selectedExisting.name,
                            currency: selectedExisting.currency,
                          })}
                        </span>
                      )}
                    </>
                  )}
                </span>
              )}
            </span>
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-light mt-2">
        {/* Inline blocker message - explains exactly why Import is disabled
            instead of leaving a dead button. */}
        {unmappedRequired.length > 0 && (
          <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-semantic-error">
            <AlertTriangle size={13} className="shrink-0" />
            {t('costs_catalogs.import_required_missing', {
              defaultValue: 'Map the required columns before importing: {{fields}}.',
              fields: fmtList(unmappedRequired.map((f) => fieldMeta(f).label)),
            })}
          </span>
        )}
        {/* This action discards the staged file entirely (handleReset), so it
            is labelled Cancel rather than Back. Both buttons take the large
            size: this is the page's committing step, and matching heights keep
            the row level while the primary carries the weight. */}
        <Button variant="secondary" size="lg" onClick={onCancel} disabled={importing}>
          {t('costs_import.cancel', { defaultValue: 'Cancel' })}
        </Button>
        {/* `loading` is deliberately not used - it replaces the label with a
            spinner, so the translated "Importing..." below would never reach
            the screen and the button would shrink to icon width. `canImport`
            already goes false while importing, which disables it. */}
        <Button
          variant="primary"
          size="lg"
          onClick={onImport}
          disabled={!canImport}
          icon={
            importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />
          }
        >
          <BusyLabel
            idle={t('costs_import.import_mapped', { defaultValue: 'Import' })}
            busy={t('costs.import_importing', { defaultValue: 'Importing...' })}
            isBusy={importing}
          />
        </Button>
      </div>
    </Card>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function ImportDatabasePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Column-mapping panel state. Once a file is previewed we move into the
  // mapping step: `previewData` holds the headers/sample/suggestions,
  // `columnMap` is the user-editable canonical-field -> raw-header mapping and
  // `catalogName` groups the imported rows.
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [catalogName, setCatalogName] = useState('');
  // Target catalog step: create a new catalog inline (name + currency) or
  // import into an existing one. New is the default - the name is seeded
  // from the file name, so the zero-decision path keeps working.
  const [catalogMode, setCatalogMode] = useState<'new' | 'existing'>('new');
  const [catalogCurrency, setCatalogCurrency] = useState('');
  const [existingCatalogId, setExistingCatalogId] = useState('');

  // User catalogs for the "existing catalog" dropdown - only needed once
  // the mapping panel is on screen.
  const { data: userCatalogs } = useQuery<CostCatalog[]>({
    queryKey: ['costs', 'catalogs'],
    queryFn: fetchCostCatalogs,
    retry: false,
    staleTime: 60_000,
    enabled: previewData !== null,
  });

  // Strip the extension from a filename for a friendly default catalog name.
  const baseName = useCallback(
    (name: string) => name.replace(/\.[^.]+$/, '').trim() || name,
    [],
  );

  // The file currently staged by the user. Preview results arriving for any
  // other (stale) file are ignored, so a slow preview response can never
  // clobber the mapping panel of a file picked later.
  const currentFileRef = useRef<File | null>(null);

  // Preview step - kicked off after a file is chosen. On success we enter the
  // mapping panel; on failure the file stays staged and the user can run the
  // auto-detect "Import All" fallback that renders below the drop zone.
  const previewMutation = useMutation({
    mutationFn: (file: File) => previewCostFile(file),
    onSuccess: (data, file) => {
      // Stale response for a file that is no longer staged - ignore it.
      if (currentFileRef.current !== file) return;
      setPreviewData(data);
      // Seed the editable map from the backend's suggestions, but only keep
      // suggestions whose header actually exists in the file.
      const seeded: Record<string, string> = {};
      for (const field of data.target_fields) {
        const suggested = data.suggested_map[field];
        seeded[field] = suggested && data.headers.includes(suggested) ? suggested : NOT_MAPPED;
      }
      setColumnMap(seeded);
      setCatalogName(baseName(file.name));
    },
    onError: (err: Error, file) => {
      if (currentFileRef.current !== file) return;
      // Preview unavailable (network / parse). Keep the staged file and let
      // the user decide: the "Import All" fallback button below the drop zone
      // runs the auto-detect import. Never import without an explicit click.
      addToast({
        type: 'warning',
        title: t('costs_import.preview_failed', { defaultValue: 'Could not preview columns' }),
        message: t('costs_import.preview_failed_fallback', {
          defaultValue:
            'Your file is still staged. Use "Import All" below to import it with automatic column detection.',
        }),
      });
      if (import.meta.env.DEV) console.error('Cost-file preview failed:', err);
    },
  });

  const handleFile = useCallback(
    (file: File) => {
      const type = getFileType(file.name);
      if (!type) {
        addToast({
          type: 'error',
          title: t('costs.import_unsupported_format', {
            defaultValue: 'Unsupported file format',
          }),
          message: t('costs.import_supported_hint', {
            defaultValue: 'Please upload an Excel (.xlsx) or CSV (.csv) file.',
          }),
        });
        return;
      }

      currentFileRef.current = file;
      setSelectedFile(file);
      setPreview({
        name: file.name,
        size: formatFileSize(file.size),
        type,
      });
      setResult(null);
      setPreviewData(null);
      setColumnMap({});
      setCatalogMode('new');
      setCatalogCurrency('');
      setExistingCatalogId('');
      previewMutation.mutate(file);
    },
    // The mutation RESULT object is a new reference every render; only the
    // ``mutate`` function is stable (react-query guarantees it), so depend
    // on that to keep handleFile from being re-created each render.
    [addToast, t, previewMutation.mutate],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  // Shared success/error handling for both the mapped import and the
  // auto-detect fallback.
  const onImportSuccess = useCallback(
    (data: ImportResult) => {
      setResult(data);
      setPreviewData(null);
      queryClient.invalidateQueries({ queryKey: ['costs'] });
      if (data.imported > 0) {
        addToast({
          type: 'success',
          title: t('costs.import_success', { defaultValue: 'Import complete' }),
          message: data.catalog
            ? t('costs_import.import_success_catalog', {
                defaultValue: '{{count}} items imported into "{{catalog}}".',
                count: data.imported,
                catalog: data.catalog,
              })
            : t('costs_import.import_success_count', {
                defaultValue: '{{count}} items imported successfully.',
                count: data.imported,
              }),
        });
      }
      // Mixed-currency rows are imported as-is (never silently rewritten) -
      // surface a separate non-blocking warning so the user knows some rows
      // kept a currency different from the catalog currency.
      if ((data.mixed_currency_count ?? 0) > 0) {
        addToast({
          type: 'warning',
          title: t('costs_catalogs.mixed_currency_label', { defaultValue: 'Mixed currencies' }),
          message: t('costs_catalogs.mixed_currency_warning', {
            defaultValue:
              '{{count}} rows carry a currency different from the catalog currency {{currency}}. They were imported with their own currency, no conversion applied.',
            count: data.mixed_currency_count,
            currency: data.catalog_currency ?? '',
          }),
        });
      }
    },
    [addToast, queryClient, t],
  );

  const onImportError = useCallback(
    (err: Error) => {
      addToast({
        type: 'error',
        title: t('costs.import_failed', { defaultValue: 'Import failed' }),
        message: err.message,
      });
    },
    [addToast, t],
  );

  // Primary import - uses the user's chosen column map + target catalog
  // (existing catalog id, or new-catalog name + currency).
  const importMutation = useMutation({
    mutationFn: () => {
      if (!selectedFile) throw new Error('No file selected');
      // Drop unmapped (empty) fields so the backend only receives real columns.
      const cleanMap: Record<string, string> = {};
      for (const [field, header] of Object.entries(columnMap)) {
        if (header) cleanMap[field] = header;
      }
      return uploadCostFile(selectedFile, {
        columnMap: cleanMap,
        ...(catalogMode === 'existing'
          ? { catalogId: existingCatalogId }
          : { catalogName, catalogCurrency }),
      });
    },
    onSuccess: onImportSuccess,
    onError: onImportError,
  });

  // Fallback import - no column map, backend auto-detects. Triggered only by
  // the explicit "Import All" button so the user is never hard-blocked.
  const directImportMutation = useMutation({
    mutationFn: (file: File) => uploadCostFile(file),
    onSuccess: onImportSuccess,
    onError: onImportError,
  });

  const handleReset = useCallback(() => {
    currentFileRef.current = null;
    setSelectedFile(null);
    setPreview(null);
    setResult(null);
    setPreviewData(null);
    setColumnMap({});
    setCatalogName('');
    setCatalogMode('new');
    setCatalogCurrency('');
    setExistingCatalogId('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: t('costs.title', 'Cost Database'), to: '/costs' },
          { label: t('costs.import_title', 'Import Cost Database') },
        ]}
      />

      {/* Canonical top block — the breadcrumb above carries the Cost Database
          > Import trail; the module name + icon are shown by the global top
          bar. The page renders only its subtitle. */}
      <PageHeader
        srTitle={t('costs.import_title', { defaultValue: 'Import Cost Database' })}
        subtitle={t('costs.import_subtitle', {
          defaultValue: 'Load a pricing database or upload your own file.',
        })}
      />

      <DismissibleInfo
        storageKey="costs-import"
        title={t('costs_import.intro_title', { defaultValue: 'Get a regional price book in minutes' })}
        more={t('costs_import.intro_more', { defaultValue: '' }) ? <IntroRichText text={t('costs_import.intro_more')} /> : undefined}
        links={[
          { label: t('nav.costs', { defaultValue: 'Cost Database' }), onClick: () => navigate('/costs') },
          { label: t('nav.catalog', { defaultValue: 'Resource Catalog' }), onClick: () => navigate('/catalog') },
          { label: t('nav.assemblies', { defaultValue: 'Assemblies' }), onClick: () => navigate('/assemblies') },
        ]}
      >
        {t('costs_import.intro_body', {
          defaultValue:
            'Install a regional CWICR cost database by country and currency, or upload your own Parquet file, with full resource and cost breakdowns indexed for offline use. Once installed the rates appear in the cost database and become matchable across catalog, assemblies and BOQ.',
        })}
      </DismissibleInfo>

      {/* Resource prices - price the coefficient bases (Vietnam Dinh Muc,
          Indonesia AHSP) so their zero-rate work items become estimable. */}
      <ResourcePriceSheetPanel />

      {/* Regional price lists (prezzari regionali) from the file the region publishes. */}
      <RegionalPriceListImport />

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border-light" />
        <span className="text-xs font-medium text-content-tertiary uppercase tracking-wider">
          {t('costs.or_upload_own', { defaultValue: 'or upload your own file' })}
        </span>
        <div className="h-px flex-1 bg-border-light" />
      </div>

      {/* Import result summary */}
      {result && (
        <Card className="animate-card-in">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {result.errors.length === 0 && result.imported > 0 ? (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-semantic-success-bg">
                  <CheckCircle2 size={20} className="text-semantic-success" />
                </div>
              ) : result.imported === 0 ? (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-semantic-error-bg">
                  <XCircle size={20} className="text-semantic-error" />
                </div>
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-semantic-warning-bg">
                  <AlertTriangle size={20} className="text-semantic-warning" />
                </div>
              )}
              <div>
                <h3 className="text-base font-semibold text-content-primary">
                  {t('costs.import_complete', { defaultValue: 'Import Complete' })}
                </h3>
                <p className="text-sm text-content-secondary">
                  {t('costs.import_rows_processed_count', {
                    count: result.total_rows,
                    defaultValue_one: '{{count}} row processed',
                    defaultValue: '{{count}} rows processed',
                  })}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-semantic-success-bg/50 px-4 py-3 text-center">
                <div className="text-2xl font-bold text-semantic-success">{result.imported}</div>
                <div className="text-xs text-content-secondary mt-0.5">
                  {t('costs.import_imported', { defaultValue: 'Imported' })}
                </div>
              </div>
              <div className="rounded-xl bg-surface-secondary px-4 py-3 text-center">
                <div className="text-2xl font-bold text-content-secondary">{result.skipped}</div>
                <div className="text-xs text-content-secondary mt-0.5">
                  {t('costs.import_skipped', { defaultValue: 'Skipped' })}
                </div>
              </div>
              <div className="rounded-xl bg-semantic-error-bg/50 px-4 py-3 text-center">
                <div className="text-2xl font-bold text-semantic-error">
                  {result.errors.length}
                </div>
                <div className="text-xs text-content-secondary mt-0.5">
                  {t('costs.import_errors', { defaultValue: 'Errors' })}
                </div>
              </div>
            </div>

            {/* Target catalog summary */}
            {result.catalog && (
              <div className="flex items-center gap-2 rounded-lg border border-border-light bg-surface-secondary/40 px-3 py-2 text-xs text-content-secondary">
                <BookOpen size={14} className="text-oe-blue shrink-0" />
                {t('costs_catalogs.result_catalog_line', {
                  defaultValue: 'Imported into catalog "{{name}}"{{currency}}.',
                  name: result.catalog,
                  currency: result.catalog_currency ? ` (${result.catalog_currency})` : '',
                })}
              </div>
            )}

            {/* Mixed-currency warning - rows kept their own currency */}
            {(result.mixed_currency_count ?? 0) > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  <span className="font-semibold block mb-0.5">
                    {t('costs_catalogs.mixed_currency_label', { defaultValue: 'Mixed currencies' })}
                  </span>
                  {t('costs_catalogs.mixed_currency_warning', {
                    defaultValue:
                      '{{count}} rows carry a currency different from the catalog currency {{currency}}. They were imported with their own currency, no conversion applied.',
                    count: result.mixed_currency_count,
                    currency: result.catalog_currency ?? '',
                  })}
                </span>
              </div>
            )}

            {/* Error details (first 5) */}
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-semantic-error/20 bg-semantic-error-bg/30 p-3">
                <p className="text-xs font-medium text-semantic-error mb-2">
                  {t('costs.import_error_details', { defaultValue: 'Error details' })}
                </p>
                <div className="space-y-1.5">
                  {result.errors.slice(0, 5).map((err) => (
                    <p key={`row-${err.row}`} className="text-xs text-content-secondary">
                      <span className="font-mono text-semantic-error">
                        {t('costs.import_row', { defaultValue: 'Row' })} {err.row}
                      </span>
                      : {err.error}
                    </p>
                  ))}
                  {result.errors.length > 5 && (
                    <p className="text-xs text-content-tertiary">
                      ...
                      {t('costs.import_and_more', {
                        defaultValue: 'and {{count}} more errors',
                        count: result.errors.length - 5,
                      })}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Where the import lands. Same large size as the other two
                action rows on the page, so the three read as one family. */}
            <div className="flex items-center gap-3 pt-1">
              <Button variant="secondary" size="lg" onClick={handleReset}>
                {t('costs.import_another', { defaultValue: 'Import Another' })}
              </Button>
              <Button variant="primary" size="lg" onClick={() => navigate('/costs')}>
                {t('costs.import_go_to_database', { defaultValue: 'Go to Cost Database' })}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Upload area */}
      {!result && (
        <div className="space-y-5">
          {/* Supported formats */}
          <Card>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-oe-blue-subtle">
                <Database size={20} className="text-oe-blue" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-content-primary">
                  {t('costs.import_formats_title', { defaultValue: 'Supported formats' })}
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm text-content-secondary">
                  <li className="flex items-center gap-2">
                    <FileSpreadsheet size={14} className="text-semantic-success shrink-0" />
                    {t('costs.import_format_excel', {
                      defaultValue:
                        'Excel (.xlsx) with columns: Code, Description, Unit, Rate',
                    })}
                  </li>
                  <li className="flex items-center gap-2">
                    <FileSpreadsheet size={14} className="text-oe-blue shrink-0" />
                    {t('costs.import_format_csv', {
                      defaultValue: 'CSV (.csv) with the same columns',
                    })}
                  </li>
                </ul>
                <p className="mt-2 text-xs text-content-tertiary">
                  {t('costs.import_columns_hint', {
                    defaultValue:
                      'Columns are auto-detected. Accepted headers: Code, Description, Unit, Rate/Price/Cost, Currency, Classification.',
                  })}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-content-secondary mr-1">
                    {t('costs.import_templates_label', { defaultValue: 'Download a template:' })}
                  </span>
                  <a
                    href="/templates/example_us_construction.csv"
                    download
                    className={TEMPLATE_LINK_CLASS}
                  >
                    <Download size={12} />
                    {t('costs.import_template_example', { defaultValue: 'Example US construction (30 rows)' })}
                  </a>
                </div>
                <p className="mt-2 text-[11px] text-content-tertiary">
                  {t('costs.import_template_help', {
                    defaultValue: 'See docs/cost-database-import.md for the full resource-based costing guide.',
                  })}
                </p>
              </div>
            </div>
          </Card>

          {/* Drag & drop zone */}
          <Card padding="none" className="overflow-hidden">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center px-8 py-16 cursor-pointer transition-all duration-normal ease-oe ${
                isDragging
                  ? 'bg-oe-blue-subtle border-2 border-dashed border-oe-blue'
                  : selectedFile
                    ? 'bg-surface-secondary'
                    : 'bg-surface-elevated hover:bg-surface-secondary border-2 border-dashed border-border-light hover:border-border'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv,.xls"
                onChange={handleFileInput}
                className="hidden"
              />

              {selectedFile && preview ? (
                <div className="flex flex-col items-center gap-3 animate-fade-in">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-oe-blue-subtle">
                    <FileSpreadsheet size={28} className="text-oe-blue" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-content-primary">{preview.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="blue" size="sm">
                        {preview.type === 'excel' ? 'Excel' : 'CSV'}
                      </Badge>
                      <span className="text-xs text-content-tertiary">{preview.size}</span>
                    </div>
                  </div>
                  <p className="text-xs text-content-tertiary mt-1">
                    {t('costs.import_click_to_change', {
                      defaultValue: 'Click to choose a different file',
                    })}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div
                    className={`flex h-14 w-14 items-center justify-center rounded-2xl transition-colors duration-normal ${
                      isDragging
                        ? 'bg-oe-blue text-white'
                        : 'bg-surface-secondary text-content-tertiary'
                    }`}
                  >
                    <Upload size={28} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-content-primary">
                      {isDragging
                        ? t('costs.import_drop_here', { defaultValue: 'Drop your file here' })
                        : t('costs.import_drop_or_click', {
                            defaultValue: 'Drop your file here or click to browse',
                          })}
                    </p>
                    <p className="mt-1 text-xs text-content-tertiary">
                      {t('costs.import_accepted', {
                        defaultValue: 'Excel (.xlsx) or CSV (.csv)',
                      })}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Previewing columns - brief loading state before the mapping panel */}
          {selectedFile && previewMutation.isPending && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border-light bg-surface-secondary/40 px-4 py-6 text-sm text-content-secondary animate-fade-in">
              <Loader2 size={16} className="animate-spin text-oe-blue" />
              {t('costs_import.analyzing_columns', {
                defaultValue: 'Reading columns from your file...',
              })}
            </div>
          )}

          {/* Column mapping panel - shown once preview resolves */}
          {selectedFile && previewData && (
            <ColumnMappingPanel
              data={previewData}
              columnMap={columnMap}
              onChangeField={(field, header) =>
                setColumnMap((prev) => ({ ...prev, [field]: header }))
              }
              catalogMode={catalogMode}
              onCatalogModeChange={setCatalogMode}
              catalogName={catalogName}
              onCatalogNameChange={setCatalogName}
              catalogCurrency={catalogCurrency}
              onCatalogCurrencyChange={setCatalogCurrency}
              existingCatalogId={existingCatalogId}
              onExistingCatalogChange={setExistingCatalogId}
              catalogs={userCatalogs ?? []}
              onImport={() => importMutation.mutate()}
              onCancel={handleReset}
              importing={importMutation.isPending}
            />
          )}

          {/* Fallback actions - only when a file is staged but there is no
              preview yet and we are not actively previewing (e.g. preview
              failed or produced nothing). Keeps a direct, user-initiated
              auto-detect import path available. */}
          {selectedFile && !previewData && !previewMutation.isPending && (
            <div className="flex items-center justify-end gap-3 animate-fade-in">
              <Button variant="secondary" size="lg" onClick={handleReset} disabled={directImportMutation.isPending}>
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
              {/* Same reasoning as the mapped-import button above: the spinner
                  rides in the icon slot so the label survives, and `disabled`
                  stands in for what `loading` used to do. */}
              <Button
                variant="primary"
                size="lg"
                onClick={() => directImportMutation.mutate(selectedFile)}
                disabled={directImportMutation.isPending}
                icon={
                  directImportMutation.isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Upload size={16} />
                  )
                }
              >
                <BusyLabel
                  idle={t('costs.import_all', { defaultValue: 'Import All' })}
                  busy={t('costs.import_importing', { defaultValue: 'Importing...' })}
                  isBusy={directImportMutation.isPending}
                />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
