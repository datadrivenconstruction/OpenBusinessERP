/**
 * Company settings for business workspaces: one searchable page with clear
 * sections (profile, finance, tax rates, numbering, templates, people, modules).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Hash, Package, Search, Users } from 'lucide-react';
import { apiGet } from '@/shared/lib/api';
import { BusinessDocumentsSettings, profileMatches } from './BusinessDocumentsSettings';
import { MAIL_KEYWORDS, MailSettingsSection } from './MailSettings';
import { DESIGN_KEYWORDS, DocumentDesignSettings } from './DocumentDesignSettings';

interface NumberingRow {
  area: string;
  kind: string;
  prefix: string;
  last_number: number;
  next_number: string;
}

const AREA_LABEL: Record<string, string> = { sales: 'Sales', purchasing: 'Purchasing' };
const KIND_LABEL: Record<string, string> = {
  quote: 'Quote', order: 'Order', invoice: 'Invoice', credit_note: 'Credit note', receipt: 'Goods receipt', bill: 'Bill',
};

const LINK_SECTIONS = [
  {
    id: 'people',
    tab: 'team',
    icon: Users,
    keywords: 'users roles team members permissions people',
    titleKey: 'settings.hub_people',
    title: 'Users & roles',
    descKey: 'settings.hub_people_desc',
    desc: 'Invite colleagues and decide who may see or change what.',
    cta: 'Manage team',
  },
  {
    id: 'modules',
    tab: 'modules',
    icon: Package,
    keywords: 'modules apps features on off enable disable',
    titleKey: 'settings.hub_modules',
    title: 'Modules',
    descKey: 'settings.hub_modules_desc',
    desc: 'Switch parts of the workspace on or off to keep it simple.',
    cta: 'Manage modules',
  },
] as const;

const NUMBERING_KEYWORDS = 'numbering sequences numbers prefix invoice quote order bill receipt';

export function NumberingSection() {
  const { t } = useTranslation();
  const rows = useQuery({
    queryKey: ['business-numbering'],
    queryFn: () => apiGet<NumberingRow[]>('/v1/business-settings/numbering/'),
    retry: false,
  });
  return (
    <section className="mb-6 rounded-md border border-border-light bg-surface-primary p-4" data-testid="numbering-section">
      <h2 className="flex items-center gap-2 text-base font-semibold text-content-primary">
        <Hash className="h-4 w-4" />
        {t('settings.hub_numbering', { defaultValue: 'Document numbering' })}
      </h2>
      <p className="mb-3 text-sm text-content-secondary">
        {t('settings.hub_numbering_desc', {
          defaultValue: 'Numbers are assigned automatically without gaps. This shows the next number per document type.',
        })}
      </p>
      {rows.isLoading && <p className="text-sm text-content-tertiary">{t('common.loading', { defaultValue: 'Loading...' })}</p>}
      {rows.isError && (
        <p className="text-sm text-content-secondary">
          {t('settings.hub_numbering_error', { defaultValue: 'Numbering is not available for this company yet.' })}
        </p>
      )}
      {rows.data && rows.data.length === 0 && (
        <p className="text-sm text-content-secondary">
          {t('settings.hub_numbering_empty', { defaultValue: 'No numbered documents yet. Numbers appear after the first quote or invoice.' })}
        </p>
      )}
      {rows.data && rows.data.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-content-tertiary">
              <th className="py-1 pr-3 font-medium">{t('settings.hub_num_area', { defaultValue: 'Area' })}</th>
              <th className="py-1 pr-3 font-medium">{t('settings.hub_num_type', { defaultValue: 'Document' })}</th>
              <th className="py-1 pr-3 font-medium">{t('settings.hub_num_last', { defaultValue: 'Issued so far' })}</th>
              <th className="py-1 font-medium">{t('settings.hub_num_next', { defaultValue: 'Next number' })}</th>
            </tr>
          </thead>
          <tbody>
            {rows.data.map((r) => (
              <tr key={`${r.area}-${r.kind}`} className="border-t border-border-light text-content-primary">
                <td className="py-1 pr-3">{t(`settings.hub_area_${r.area}`, { defaultValue: AREA_LABEL[r.area] ?? r.area })}</td>
                <td className="py-1 pr-3">{t(`settings.hub_kind_${r.kind}`, { defaultValue: KIND_LABEL[r.kind] ?? r.kind })}</td>
                <td className="py-1 pr-3 tabular-nums">{r.last_number}</td>
                <td className="py-1 font-mono">{r.next_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function BusinessSettingsHub({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const showProfile = profileMatches(q);
  const showNumbering = !q || NUMBERING_KEYWORDS.includes(q);
  const showMail = !q || MAIL_KEYWORDS.includes(q);
  const showDesign = !q || DESIGN_KEYWORDS.includes(q);
  const links = LINK_SECTIONS.filter((s) => !q || s.keywords.includes(q));
  const nothing = !showProfile && !showDesign && !showNumbering && !showMail && links.length === 0;

  return (
    <div data-testid="business-settings-hub">
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-content-tertiary" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('settings.hub_search', { defaultValue: 'Search settings (tax, logo, numbering...)' })}
          aria-label={t('settings.hub_search_label', { defaultValue: 'Search settings' })}
          className="w-full rounded border border-border-light bg-surface-primary py-1.5 pl-8 pr-2 text-sm text-content-primary focus:border-border focus:outline-none"
        />
      </div>

      {showProfile && <BusinessDocumentsSettings canEdit={canEdit} query={query} />}
      {showDesign && <DocumentDesignSettings canEdit={canEdit} />}
      {showNumbering && <NumberingSection />}
      {showMail && <MailSettingsSection canEdit={canEdit} />}

      {links.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          {links.map((s) => (
            <section key={s.id} className="rounded-md border border-border-light bg-surface-primary p-4" data-testid={`hub-${s.id}`}>
              <h2 className="flex items-center gap-2 text-base font-semibold text-content-primary">
                <s.icon className="h-4 w-4" />
                {t(s.titleKey, { defaultValue: s.title })}
              </h2>
              <p className="mb-3 text-sm text-content-secondary">{t(s.descKey, { defaultValue: s.desc })}</p>
              <Link to={`/settings?tab=${s.tab}`} className="text-sm font-medium text-oe-blue hover:underline">
                {t(`settings.hub_${s.id}_cta`, { defaultValue: s.cta })}
              </Link>
            </section>
          ))}
        </div>
      )}

      {nothing && (
        <div className="rounded-md border border-dashed border-border-light p-8 text-center" data-testid="hub-empty">
          <p className="text-sm font-medium text-content-primary">
            {t('settings.hub_nothing', { defaultValue: 'No settings match "{{q}}"', q: query.trim() })}
          </p>
          <p className="mt-1 text-sm text-content-secondary">
            {t('settings.hub_nothing_hint', { defaultValue: 'Try a shorter word such as tax, logo, bank or numbering.' })}
          </p>
        </div>
      )}
    </div>
  );
}
