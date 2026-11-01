/**
 * Document design (business workspaces): PDF template, accent colour, font,
 * logo placement and footer blocks for sales documents, dunning letters and
 * purchase orders, with a live preview rendered by the backend.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';
import { apiGet, apiPut, fetchWithAuth, getErrorMessage } from '@/shared/lib/api';
import { Button } from '@/shared/ui/Button';

const TEMPLATES = ['classic', 'modern', 'compact'] as const;
const FONTS = ['dejavu_sans', 'helvetica', 'times'] as const;
const LOGO_POSITIONS = ['left', 'center', 'right'] as const;
const LOGO_SIZES = ['small', 'medium', 'large'] as const;
const FOOTER_BLOCKS = ['address', 'contact', 'legal', 'bank'] as const;
const PREVIEW_KINDS = ['invoice', 'quote', 'order', 'credit_note', 'dunning', 'purchase_order'] as const;
const PREVIEW_LANGS = ['en', 'de', 'fr', 'es', 'it', 'pl', 'ru', 'ar'] as const;

export const DESIGN_KEYWORDS = 'document design pdf template layout colour color font logo footer letterhead din preview';

export interface DocumentDesign {
  template: (typeof TEMPLATES)[number];
  accent_color: string;
  font: (typeof FONTS)[number];
  logo_position: (typeof LOGO_POSITIONS)[number];
  logo_size: (typeof LOGO_SIZES)[number];
  footer_blocks: string[];
  header_contact: boolean;
  page_numbers: boolean;
  din5008: boolean;
  fold_marks: boolean;
  terms_text: string;
}

const URL_BASE = '/v1/sales/settings/document-design/';
const DEFAULTS: DocumentDesign = {
  template: 'classic', accent_color: '#1f3a5f', font: 'dejavu_sans', logo_position: 'right', logo_size: 'medium',
  footer_blocks: [...FOOTER_BLOCKS], header_contact: false, page_numbers: true, din5008: true, fold_marks: true, terms_text: '',
};

export function DocumentDesignSettings({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['document-design'], queryFn: () => apiGet<DocumentDesign>(URL_BASE) });
  const [form, setForm] = useState<DocumentDesign | null>(null);
  const [kind, setKind] = useState<(typeof PREVIEW_KINDS)[number]>('invoice');
  const [language, setLanguage] = useState<(typeof PREVIEW_LANGS)[number]>('de');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewError, setPreviewError] = useState('');
  const urlRef = useRef('');

  useEffect(() => {
    if (data) setForm({ ...DEFAULTS, ...data });
  }, [data]);

  // Debounced live preview of the unsaved design.
  useEffect(() => {
    if (!form) return undefined;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetchWithAuth(`/api${URL_BASE}preview/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ design: form, kind, language }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(res.statusText || String(res.status));
        const url = URL.createObjectURL(await res.blob());
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setPreviewUrl(url);
        setPreviewError('');
      } catch (err) {
        if (!ctrl.signal.aborted) setPreviewError(getErrorMessage(err));
      }
    }, 400);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [form, kind, language]);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const save = useMutation({
    mutationFn: (body: DocumentDesign) => apiPut<DocumentDesign>(URL_BASE, body),
    onSuccess: (saved) => {
      qc.setQueryData(['document-design'], saved);
      setForm({ ...DEFAULTS, ...saved });
    },
  });

  const L: Record<string, string> = {
    tpl_classic: t('settings.docdesign_tpl_classic', { defaultValue: 'Classic' }),
    tpl_modern: t('settings.docdesign_tpl_modern', { defaultValue: 'Modern' }),
    tpl_compact: t('settings.docdesign_tpl_compact', { defaultValue: 'Compact' }),
    pos_left: t('settings.docdesign_pos_left', { defaultValue: 'Left' }),
    pos_center: t('settings.docdesign_pos_center', { defaultValue: 'Centre' }),
    pos_right: t('settings.docdesign_pos_right', { defaultValue: 'Right' }),
    size_small: t('settings.docdesign_size_small', { defaultValue: 'Small' }),
    size_medium: t('settings.docdesign_size_medium', { defaultValue: 'Medium' }),
    size_large: t('settings.docdesign_size_large', { defaultValue: 'Large' }),
    block_address: t('settings.docdesign_block_address', { defaultValue: 'Address' }),
    block_contact: t('settings.docdesign_block_contact', { defaultValue: 'Contact' }),
    block_legal: t('settings.docdesign_block_legal', { defaultValue: 'Legal (register, directors, VAT ID)' }),
    block_bank: t('settings.docdesign_block_bank', { defaultValue: 'Bank details' }),
    header_contact: t('settings.docdesign_header_contact', { defaultValue: 'Company address and contact in the header' }),
    page_numbers: t('settings.docdesign_page_numbers', { defaultValue: 'Page numbers "Page x of y"' }),
    din5008: t('settings.docdesign_din5008', { defaultValue: 'DIN 5008 address window with return address' }),
    fold_marks: t('settings.docdesign_fold_marks', { defaultValue: 'Fold and punch marks' }),
    kind_invoice: t('settings.docdesign_kind_invoice', { defaultValue: 'Invoice' }),
    kind_quote: t('settings.docdesign_kind_quote', { defaultValue: 'Quote' }),
    kind_order: t('settings.docdesign_kind_order', { defaultValue: 'Order confirmation' }),
    kind_credit_note: t('settings.docdesign_kind_credit_note', { defaultValue: 'Credit note' }),
    kind_dunning: t('settings.docdesign_kind_dunning', { defaultValue: 'Payment reminder' }),
    kind_purchase_order: t('settings.docdesign_kind_purchase_order', { defaultValue: 'Purchase order' }),
  };
  if (!form) return null;
  const set = (patch: Partial<DocumentDesign>) => setForm({ ...form, ...patch });
  const toggleBlock = (b: string) =>
    set({ footer_blocks: form.footer_blocks.includes(b) ? form.footer_blocks.filter((x) => x !== b) : [...form.footer_blocks, b] });
  const input = 'rounded border border-border-light bg-surface-primary px-2 py-1 text-sm text-content-primary disabled:opacity-60';
  const label = 'flex flex-col gap-1 text-xs font-medium text-content-secondary';
  const dirty = JSON.stringify(form) !== JSON.stringify({ ...DEFAULTS, ...data });

  return (
    <section className="mb-6 rounded-md border border-border-light bg-surface-primary p-4" data-testid="document-design-settings">
      <h2 className="text-base font-semibold text-content-primary">
        {t('settings.docdesign_title', { defaultValue: 'Document design' })}
      </h2>
      <p className="mb-4 text-sm text-content-secondary">
        {t('settings.docdesign_desc', {
          defaultValue: 'Layout of PDF quotes, order confirmations, invoices, credit notes, reminders and purchase orders.',
        })}
      </p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label={t('settings.docdesign_template', { defaultValue: 'Template' })} className="grid grid-cols-3 gap-2">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl}
                type="button"
                role="radio"
                aria-checked={form.template === tpl}
                disabled={!canEdit}
                onClick={() => set({ template: tpl })}
                className={`rounded border px-3 py-2 text-sm ${form.template === tpl ? 'border-oe-blue bg-oe-blue/10 font-semibold text-content-primary' : 'border-border-light text-content-secondary'}`}
              >
                {L[`tpl_${tpl}`]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              {t('settings.docdesign_accent', { defaultValue: 'Accent colour' })}
              <input type="color" className="h-8 w-16 rounded border border-border-light" disabled={!canEdit} value={form.accent_color}
                onChange={(e) => set({ accent_color: e.target.value })} />
            </label>
            <label className={label}>
              {t('settings.docdesign_font', { defaultValue: 'Font' })}
              <select className={input} disabled={!canEdit} value={form.font} onChange={(e) => set({ font: e.target.value as DocumentDesign['font'] })}>
                <option value="dejavu_sans">DejaVu Sans</option>
                <option value="helvetica">Helvetica</option>
                <option value="times">Times</option>
              </select>
            </label>
            <label className={label}>
              {t('settings.docdesign_logo_position', { defaultValue: 'Logo position' })}
              <select className={input} disabled={!canEdit} value={form.logo_position}
                onChange={(e) => set({ logo_position: e.target.value as DocumentDesign['logo_position'] })}>
                {LOGO_POSITIONS.map((p) => (
                  <option key={p} value={p}>{L[`pos_${p}`]}</option>
                ))}
              </select>
            </label>
            <label className={label}>
              {t('settings.docdesign_logo_size', { defaultValue: 'Logo size' })}
              <select className={input} disabled={!canEdit} value={form.logo_size}
                onChange={(e) => set({ logo_size: e.target.value as DocumentDesign['logo_size'] })}>
                {LOGO_SIZES.map((s) => (
                  <option key={s} value={s}>{L[`size_${s}`]}</option>
                ))}
              </select>
            </label>
          </div>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-content-secondary">
              {t('settings.docdesign_footer', { defaultValue: 'Footer blocks' })}
            </legend>
            <div className="flex flex-wrap gap-3">
              {FOOTER_BLOCKS.map((b) => (
                <label key={b} className="flex items-center gap-1 text-sm text-content-primary">
                  <input type="checkbox" disabled={!canEdit} checked={form.footer_blocks.includes(b)} onChange={() => toggleBlock(b)} />
                  {L[`block_${b}`]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1">
            {(
              [
                ['header_contact', 'Company address and contact in the header'],
                ['page_numbers', 'Page numbers "Page x of y"'],
                ['din5008', 'DIN 5008 address window with return address'],
                ['fold_marks', 'Fold and punch marks'],
              ] as const
            ).map(([key]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-content-primary">
                <input type="checkbox" disabled={!canEdit} checked={form[key]} onChange={(e) => set({ [key]: e.target.checked })} />
                {L[key]}
              </label>
            ))}
          </div>
          <label className={label}>
            {t('settings.docdesign_terms', { defaultValue: 'Terms and conditions (printed at the end)' })}
            <textarea className={`${input} h-24`} maxLength={2000} disabled={!canEdit} value={form.terms_text}
              onChange={(e) => set({ terms_text: e.target.value })} />
          </label>
          {canEdit && (
            <div className="flex items-center gap-3">
              <Button onClick={() => save.mutate(form)} disabled={!dirty || save.isPending} icon={<Save className="h-4 w-4" />}>
                {t('settings.docdesign_save', { defaultValue: 'Save design' })}
              </Button>
              {save.isError && <span className="text-sm text-semantic-error">{getErrorMessage(save.error)}</span>}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <select aria-label={t('settings.docdesign_preview_kind', { defaultValue: 'Preview document' })} className={input}
              value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {PREVIEW_KINDS.map((k) => (
                <option key={k} value={k}>{L[`kind_${k}`]}</option>
              ))}
            </select>
            <select aria-label={t('settings.docdesign_preview_lang', { defaultValue: 'Preview language' })} className={input}
              value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
              {PREVIEW_LANGS.map((l) => (
                <option key={l} value={l}>{l.toUpperCase()}</option>
              ))}
            </select>
          </div>
          {previewError && <p className="text-sm text-semantic-error">{previewError}</p>}
          {previewUrl && (
            <iframe
              title={t('settings.docdesign_preview', { defaultValue: 'Preview' })}
              src={previewUrl}
              className="h-[560px] w-full rounded border border-border-light bg-white"
              data-testid="document-design-preview"
            />
          )}
        </div>
      </div>
    </section>
  );
}
