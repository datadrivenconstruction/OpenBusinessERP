/**
 * OpenBusinessERP onboarding: language -> company -> industry -> apps -> launch.
 *
 * Writes the workspace business settings (country, currency, fiscal year,
 * industry, size), the user's currency preference and the module profile, then
 * opens the app. Construction is an opt-in industry pack on the Modules page.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  CheckCircle2,
  Command,
  Code2,
  Factory,
  HeartHandshake,
  LayoutGrid,
  Loader2,
  RotateCcw,
  Route,
  Search,
  ShoppingCart,
  Truck,
  Wrench,
  BedDouble,
  Calculator,
  Dumbbell,
  GraduationCap,
  Hammer,
  HeartPulse,
  Info,
  KeyRound,
  Palette,
  Scale,
  Sparkles,
  Stethoscope,
  Store,
  UtensilsCrossed,
  Wheat,
  type LucideIcon,
} from 'lucide-react';

import { Button, CountryFlag, Input, Logo, SearchableSelect } from '@/shared/ui';
import { apiGet, apiPatch, apiPost, apiPut } from '@/shared/lib/api';
import { COUNTRIES, getCountry, sortedCountries } from '@/shared/lib/countries';
import { SUPPORTED_LANGUAGES, changeLanguage, detectCountry, matchSupportedLanguage } from '@/app/i18n';
import { useModuleStore } from '@/stores/useModuleStore';
import { usePreferencesStore } from '@/stores/usePreferencesStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { normalizeRole } from '@/shared/lib/roles';
import { useMeOnboardingQueryKey } from '@/app/layout/meOnboardingQuery';
import { isOnboardingCompleted, markOnboardingCompleted } from './OnboardingWizard';
import { fetchBusinessDemoCases, installBusinessDemoCase, type BusinessDemoCase } from '@/features/business-demo/api';

// ── Data ────────────────────────────────────────────────────────────────────

interface Preset {
  key: string;
  label: string;
  description: string;
  icon: string;
  tags: string[];
  enabled_modules: string[];
  pack?: 'business' | 'construction';
  recommended_modules?: string[];
  optional_modules?: string[];
  section?: string;
  tax_hint?: string;
}

const INDUSTRY_ICONS: Record<string, LucideIcon> = {
  Truck,
  Briefcase,
  Factory,
  ShoppingCart,
  Wrench,
  Route,
  Code2,
  HeartHandshake,
  LayoutGrid,
  BedDouble,
  Calculator,
  Dumbbell,
  GraduationCap,
  Hammer,
  HeartPulse,
  KeyRound,
  Palette,
  Scale,
  Sparkles,
  Stethoscope,
  Store,
  UtensilsCrossed,
  Wheat,
};

/** Apps shown on the apps step, by business area. Only modules that have a business screen. */
const APP_GROUPS: { id: string; label: string; keys: string[] }[] = [
  { id: 'sell', label: 'Sell', keys: ['crm', 'sales', 'contracts', 'portal', 'service'] },
  { id: 'buy', label: 'Buy & stock', keys: ['procurement', 'supplier_catalogs', 'equipment'] },
  { id: 'finance', label: 'Finance', keys: ['gl', 'finance', 'funding', 'bi_dashboards'] },
  {
    id: 'operations',
    label: 'Operations',
    keys: ['appointments', 'schedule', 'tasks', 'qms', 'inspections', 'ncr', 'safety', 'risk'],
  },
  { id: 'collaboration', label: 'Collaboration', keys: ['documents', 'meetings', 'correspondence', 'enterprise_workflows'] },
  { id: 'ai', label: 'AI & integrations', keys: ['ai', 'erp_chat', 'ai_agents', 'integrations'] },
];

const ALL_APP_KEYS = APP_GROUPS.flatMap((g) => g.keys);

/** Same edges as the backend manifests, for the apps users can toggle. */
const APP_DEPENDS: Record<string, string[]> = {
  sales: ['gl'],
  erp_chat: ['ai'],
  ai_agents: ['ai'],
  supplier_catalogs: ['procurement'],
};

/** Platform plumbing a profile carries but the user never toggles. */
const SYSTEM_KEYS: string[] = [];

/** Business wording for the apps step; module catalogue copy is written for construction. */
const APP_COPY: Record<string, [string, string]> = {
  crm: ['CRM', 'Leads, deals, accounts and follow-ups'],
  sales: ['Sales', 'Quotes, sales orders, invoices and incoming payments'],
  contracts: ['Contracts', 'Customer and supplier agreements, terms and renewals'],
  portal: ['Customer portal', 'Customers see their orders, invoices and documents'],
  service: ['Service desk', 'Tickets, SLAs and after-sales requests'],
  procurement: ['Purchasing', 'Purchase requests, orders and supplier bills'],
  supplier_catalogs: ['Supplier price lists', 'Supplier items, prices and lead times'],
  equipment: ['Equipment & fleet', 'Machines, vehicles, maintenance and usage'],
  gl: ['Accounting', 'General ledger, chart of accounts and journal entries'],
  finance: ['Budgets & cash flow', 'Budgets, payables, receivables and cash position'],
  funding: ['Grants & funding', 'Grant programmes, applications and reporting'],
  bi_dashboards: ['Reports & dashboards', 'KPIs and reports across the business'],
  appointments: ['Appointments', 'Bookings by staff and room, online booking page and reminders'],
  schedule: ['Planning', 'Timelines, milestones and Gantt charts'],
  tasks: ['Tasks', 'Assignments, due dates and checklists'],
  qms: ['Quality management', 'Procedures, audits and quality KPIs'],
  inspections: ['Inspections', 'Checklists for incoming goods, products and assets'],
  ncr: ['Non-conformances', 'Defects, root causes and corrective actions'],
  safety: ['Health & safety', 'Incidents, risk assessments and training'],
  risk: ['Risk register', 'Business risks, owners and mitigation'],
  documents: ['Documents', 'Files, versions and approvals'],
  meetings: ['Meetings', 'Agendas, minutes and action items'],
  correspondence: ['Correspondence', 'Formal letters and messages, logged and searchable'],
  enterprise_workflows: ['Approvals & workflows', 'Approval chains and automated steps'],
  ai: ['AI assistant', 'Drafts documents and answers questions on your data'],
  erp_chat: ['Ask your data', 'Questions about sales, stock or cash in plain language'],
  ai_agents: ['Automations', 'Agents that prepare routine work for your review'],
  integrations: ['Integrations', 'Connect your online shop, bank and other tools'],
};

const FEATURED_LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'pl', 'ru', 'uk'];

const SIZES = [
  { key: 'solo', label: 'Just me' },
  { key: 'small', label: '2–50' },
  { key: 'medium', label: '51–250' },
  { key: 'large', label: '250+' },
] as const;

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const CURRENCIES = Array.from(new Set(COUNTRIES.map((c) => c.currency).filter(Boolean) as string[])).sort();

interface CompanyForm {
  company_name: string;
  country_code: string;
  base_currency: string;
  fiscal_year_start_month: number;
  company_size: string;
}

const STEP_COUNT = 5;

const tagSlug = (tag: string) => tag.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// ── Shell pieces ────────────────────────────────────────────────────────────

function StepHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <div className="text-2xs font-semibold uppercase tracking-wider text-oe-blue">{eyebrow}</div>
      <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-content-primary">{title}</h1>
      {subtitle && <p className="mt-2 max-w-xl text-sm text-content-secondary leading-relaxed">{subtitle}</p>}
    </div>
  );
}

function Footer({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  busy,
  children,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  busy?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-8 flex items-center justify-between gap-3">
      {onBack ? (
        <Button variant="ghost" onClick={onBack} icon={<ArrowLeft size={16} />}>
          {t('common.back', { defaultValue: 'Back' })}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-3">
        {children}
        <Button
          variant="primary"
          size="lg"
          onClick={onNext}
          disabled={nextDisabled || busy}
          icon={busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
          iconPosition="right"
        >
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}

function Progress({ step }: { step: number }) {
  const { t } = useTranslation();
  const labels = [
    t('bizonb.step_language', { defaultValue: 'Language' }),
    t('bizonb.step_company', { defaultValue: 'Company' }),
    t('bizonb.step_industry', { defaultValue: 'Industry' }),
    t('bizonb.step_apps', { defaultValue: 'Apps' }),
    t('bizonb.step_launch', { defaultValue: 'Launch' }),
  ];
  return (
    <ol className="flex items-center gap-2" aria-label={t('bizonb.progress', { defaultValue: 'Setup progress' })}>
      {labels.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2 min-w-0" aria-current={i === step ? 'step' : undefined}>
          <span
            className={clsx(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold transition-colors',
              i < step && 'bg-oe-blue text-white',
              i === step && 'bg-oe-blue-subtle text-oe-blue ring-2 ring-oe-blue/40',
              i > step && 'bg-surface-secondary text-content-tertiary',
            )}
          >
            {i < step ? <Check size={12} strokeWidth={3} /> : i + 1}
          </span>
          <span
            className={clsx(
              'hidden md:inline truncate text-xs',
              i === step ? 'font-semibold text-content-primary' : 'text-content-tertiary',
            )}
          >
            {label}
          </span>
          {i < labels.length - 1 && <span className="h-px flex-1 bg-border-light" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

// ── Steps ───────────────────────────────────────────────────────────────────

function StepLanguage({ onNext }: { onNext: () => void }) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState(() => i18n.language ?? 'en');

  useEffect(() => {
    if (localStorage.getItem('oe_lang_explicit')) return;
    const target = matchSupportedLanguage(navigator.language) ?? 'en';
    setSelected(target);
    if (target !== i18n.language) void changeLanguage(target);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (code: string) => {
    setSelected(code);
    void changeLanguage(code);
  };
  // The common business languages, plus the current pick when it is not one of them.
  const featured = useMemo(() => {
    const codes = [selected, ...FEATURED_LANGUAGES.filter((c) => c !== selected)].slice(0, 8);
    return codes
      .map((c) => SUPPORTED_LANGUAGES.find((l) => l.code === c))
      .filter((l): l is (typeof SUPPORTED_LANGUAGES)[number] => !!l);
  }, [selected]);

  return (
    <div>
      <Logo size="md" className="mb-8" />
      <StepHeader
        eyebrow={t('bizonb.step_language', { defaultValue: 'Language' })}
        title={t('bizonb.welcome_title', { defaultValue: 'Welcome to OpenBusinessERP' })}
        subtitle={t('bizonb.welcome_subtitle', {
          defaultValue:
            'Sales, purchasing, stock, finance and people in one place. Five short steps and your workspace is ready.',
        })}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {featured.map((lang) => {
          const active = selected === lang.code;
          return (
            <button
              key={lang.code}
              type="button"
              onClick={() => pick(lang.code)}
              className={clsx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-all',
                active
                  ? 'bg-oe-blue-subtle ring-2 ring-oe-blue/50'
                  : 'bg-surface-elevated ring-1 ring-border-light hover:ring-oe-blue/30',
              )}
            >
              <CountryFlag code={lang.country} size={20} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-content-primary">{lang.name}</span>
              {active && <CheckCircle2 size={14} className="shrink-0 text-oe-blue" />}
            </button>
          );
        })}
      </div>
      <div className="mt-4 max-w-xs">
        <label htmlFor="biz-lang" className="mb-1.5 block text-xs font-medium text-content-tertiary">
          {t('bizonb.all_languages', { defaultValue: 'All {{count}} languages', count: SUPPORTED_LANGUAGES.length })}
        </label>
        <SearchableSelect
          id="biz-lang"
          value={selected}
          onChange={pick}
          options={SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: l.name, keywords: l.code }))}
        />
      </div>
      <Footer
        onNext={() => {
          localStorage.setItem('oe_lang_explicit', '1');
          onNext();
        }}
        nextLabel={t('bizonb.get_started', { defaultValue: 'Get started' })}
      />
    </div>
  );
}

function StepCompany({
  form,
  onChange,
  onBack,
  onNext,
}: {
  form: CompanyForm;
  onChange: (patch: Partial<CompanyForm>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t, i18n } = useTranslation();
  const countryOptions = useMemo(
    () =>
      sortedCountries().map((c) => ({
        value: c.code,
        label: c.name,
        hint: c.nameLocal,
        meta: c.currency,
        keywords: c.code,
      })),
    [],
  );
  const monthName = (m: number) =>
    new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(new Date(2000, m - 1, 1));

  const valid = form.company_name.trim().length > 0 && !!form.country_code && !!form.base_currency;

  return (
    <div>
      <StepHeader
        eyebrow={t('bizonb.step_company', { defaultValue: 'Company' })}
        title={t('bizonb.company_title', { defaultValue: 'Tell us about your company' })}
        subtitle={t('bizonb.company_subtitle', {
          defaultValue: 'Country and currency set up taxes, number formats and your books. You can change them later.',
        })}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Input
            label={t('bizonb.company_name', { defaultValue: 'Company name' })}
            placeholder={t('bizonb.company_name_ph', { defaultValue: 'Acme Ltd.' })}
            value={form.company_name}
            onChange={(e) => onChange({ company_name: e.target.value })}
            autoFocus
            maxLength={120}
          />
        </div>
        <div>
          <label htmlFor="biz-country" className="mb-1.5 block text-sm font-medium text-content-primary">
            {t('bizonb.country', { defaultValue: 'Country' })}
          </label>
          <SearchableSelect
            id="biz-country"
            value={form.country_code}
            onChange={(code) => {
              const currency = getCountry(code)?.currency;
              onChange({ country_code: code, ...(currency ? { base_currency: currency } : {}) });
            }}
            options={countryOptions}
            placeholder={t('bizonb.country_ph', { defaultValue: 'Select country' })}
          />
        </div>
        <div>
          <label htmlFor="biz-currency" className="mb-1.5 block text-sm font-medium text-content-primary">
            {t('bizonb.currency', { defaultValue: 'Base currency' })}
          </label>
          <SearchableSelect
            id="biz-currency"
            value={form.base_currency}
            onChange={(code) => onChange({ base_currency: code })}
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            placeholder="EUR"
          />
        </div>
        <div>
          <label htmlFor="biz-fy" className="mb-1.5 block text-sm font-medium text-content-primary">
            {t('bizonb.fiscal_year', { defaultValue: 'Fiscal year starts in' })}
          </label>
          <SearchableSelect
            id="biz-fy"
            value={String(form.fiscal_year_start_month)}
            onChange={(m) => onChange({ fiscal_year_start_month: Number(m) })}
            options={MONTHS.map((m) => ({ value: String(m), label: monthName(m) }))}
            searchThreshold={20}
          />
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-content-primary">
            {t('bizonb.team_size', { defaultValue: 'Team size' })}
          </span>
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup">
            {SIZES.map((s) => (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={form.company_size === s.key}
                onClick={() => onChange({ company_size: s.key })}
                className={clsx(
                  'rounded-lg px-2 py-2 text-xs font-medium transition-all',
                  form.company_size === s.key
                    ? 'bg-oe-blue text-white shadow-sm'
                    : 'bg-surface-elevated text-content-secondary ring-1 ring-border-light hover:ring-oe-blue/30',
                )}
              >
                {t(`bizonb.size_${s.key}`, { defaultValue: s.label })}
              </button>
            ))}
          </div>
        </div>
      </div>
      <Footer
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!valid}
        nextLabel={t('common.continue', { defaultValue: 'Continue' })}
      />
    </div>
  );
}

/** Industry step sections, in display order; presets without a section go under "Other". */
const INDUSTRY_SECTIONS: { id: string; label: string }[] = [
  { id: 'trade', label: 'Trade & production' },
  { id: 'services', label: 'Services' },
  { id: 'health', label: 'Health & care' },
  { id: 'hospitality', label: 'Hospitality & leisure' },
  { id: 'public', label: 'Public & non-profit' },
  { id: 'other', label: 'Other' },
];

function StepIndustry({
  presets,
  loading,
  selected,
  onSelect,
  onBack,
  onNext,
}: {
  presets: Preset[];
  loading: boolean;
  selected: string;
  onSelect: (key: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const label = (p: Preset) => t(`bizonb.ind_${p.key}`, { defaultValue: p.label });
  const description = (p: Preset) => t(`bizonb.ind_${p.key}_desc`, { defaultValue: p.description });
  const tagLabel = (tag: string) => t(`bizonb.tag_${tagSlug(tag)}`, { defaultValue: tag });
  const needle = query.trim().toLowerCase();
  const sections = INDUSTRY_SECTIONS.map((s) => ({
    ...s,
    items: presets.filter((p) => {
      const section = INDUSTRY_SECTIONS.some((x) => x.id === p.section) ? p.section : 'other';
      if (section !== s.id) return false;
      if (!needle) return true;
      return [label(p), description(p), p.label, ...p.tags.map(tagLabel)].some((v) => v.toLowerCase().includes(needle));
    }),
  })).filter((s) => s.items.length > 0 || (s.id === 'other' && !needle));
  const selectedPreset = presets.find((p) => p.key === selected);

  const card = (p: Preset) => {
    const Icon = INDUSTRY_ICONS[p.icon] ?? LayoutGrid;
    const active = selected === p.key;
    return (
      <button
        key={p.key}
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => onSelect(p.key)}
        onDoubleClick={() => {
          onSelect(p.key);
          onNext();
        }}
        className={clsx(
          'group relative flex flex-col items-start gap-1.5 rounded-xl p-3.5 text-start transition-all',
          active
            ? 'bg-oe-blue-subtle ring-2 ring-oe-blue/60 shadow-sm'
            : 'bg-surface-elevated ring-1 ring-border-light hover:-translate-y-0.5 hover:ring-oe-blue/30 hover:shadow-md',
        )}
      >
        <span className="flex items-center gap-2.5 pe-5">
          <span
            className={clsx(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              active ? 'bg-oe-blue text-white' : 'bg-surface-secondary text-content-secondary',
            )}
          >
            <Icon size={16} />
          </span>
          <span className="text-sm font-semibold leading-tight text-content-primary">{label(p)}</span>
        </span>
        <span className="text-xs leading-snug text-content-secondary">{description(p)}</span>
        {p.tags.length > 0 && (
          <span className="mt-auto flex flex-wrap gap-1 pt-1">
            {p.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className={clsx(
                  'rounded-md px-1.5 py-0.5 text-2xs font-medium',
                  active ? 'bg-white/70 text-oe-blue dark:bg-white/10' : 'bg-surface-secondary text-content-tertiary',
                )}
              >
                {tagLabel(tag)}
              </span>
            ))}
          </span>
        )}
        {active && <CheckCircle2 size={16} className="absolute end-3 top-3 text-oe-blue" />}
      </button>
    );
  };

  return (
    <div>
      <StepHeader
        eyebrow={t('bizonb.step_industry', { defaultValue: 'Industry' })}
        title={t('bizonb.industry_title', { defaultValue: 'What does your company do?' })}
        subtitle={t('bizonb.industry_subtitle', {
          defaultValue: 'We switch on the apps your industry needs. Nothing is locked: add or remove apps any time.',
        })}
      />
      <div className="relative mb-4">
        <Search
          size={15}
          className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-content-tertiary"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('bizonb.industry_search', { defaultValue: 'Search industries, e.g. dental, café, law' })}
          aria-label={t('bizonb.industry_search_label', { defaultValue: 'Search industries' })}
          className="h-9 w-full rounded-lg bg-surface-elevated ps-9 pe-3 text-sm text-content-primary ring-1 ring-border-light placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-oe-blue/40"
        />
      </div>
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-surface-secondary" />
          ))}
        </div>
      ) : (
        <div className="space-y-5" role="radiogroup">
          {sections.map((s) => (
            <section key={s.id} aria-labelledby={`biz-ind-${s.id}`}>
              <h3
                id={`biz-ind-${s.id}`}
                className="mb-2 text-2xs font-semibold uppercase tracking-wide text-content-tertiary"
              >
                {t(`bizonb.ind_section_${s.id}`, { defaultValue: s.label })}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {s.items.map(card)}
              </div>
            </section>
          ))}
          {sections.length === 0 && (
            <p className="py-6 text-center text-sm text-content-tertiary">
              {t('bizonb.industry_no_match', {
                defaultValue: 'No industry matches. Pick "Something else" to start with every app.',
              })}
            </p>
          )}
        </div>
      )}
      {selectedPreset?.tax_hint && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-surface-secondary px-3 py-2 text-xs leading-snug text-content-secondary">
          <Info size={14} className="mt-0.5 shrink-0 text-content-tertiary" />
          <span>{t(`bizonb.ind_${selectedPreset.key}_tax`, { defaultValue: selectedPreset.tax_hint })}</span>
        </p>
      )}
      <Footer
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!selected}
        nextLabel={t('common.continue', { defaultValue: 'Continue' })}
      />
    </div>
  );
}

function StepApps({
  enabled,
  recommended,
  presets,
  industry,
  onSelectIndustry,
  onToggle,
  onSetMany,
  onReset,
  onBack,
  onNext,
}: {
  enabled: Set<string>;
  recommended: Set<string>;
  presets: Preset[];
  industry: string;
  onSelectIndustry: (key: string) => void;
  onToggle: (key: string) => void;
  onSetMany: (keys: string[], on: boolean) => void;
  onReset: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const appLabel = (key: string) => t(`bizonb.app_${key}`, { defaultValue: APP_COPY[key]?.[0] ?? key });
  const appDesc = (key: string) => t(`bizonb.app_${key}_desc`, { defaultValue: APP_COPY[key]?.[1] ?? '' });

  const needle = query.trim().toLowerCase();
  const groups = APP_GROUPS.map((g) => ({
    ...g,
    visible: needle
      ? g.keys.filter((k) => `${appLabel(k)} ${appDesc(k)} ${k}`.toLowerCase().includes(needle))
      : g.keys,
  })).filter((g) => g.visible.length > 0);

  const count = ALL_APP_KEYS.filter((k) => enabled.has(k)).length;
  const isRecommendedSet = ALL_APP_KEYS.every((k) => enabled.has(k) === recommended.has(k));

  return (
    <div>
      <StepHeader
        eyebrow={t('bizonb.step_apps', { defaultValue: 'Apps' })}
        title={t('bizonb.apps_title', { defaultValue: 'Choose your apps' })}
        subtitle={t('bizonb.apps_subtitle', {
          defaultValue:
            'The apps recommended for your industry are already selected. Add more now or any time later, the menu follows.',
        })}
      />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-content-tertiary"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('bizonb.apps_search', { defaultValue: 'Search apps' })}
            aria-label={t('bizonb.apps_search', { defaultValue: 'Search apps' })}
            className="h-9 w-full rounded-lg bg-surface-elevated ps-9 pe-3 text-sm text-content-primary ring-1 ring-border-light placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-oe-blue/40"
          />
        </div>
        {presets.length > 0 && (
          <div className="sm:w-64">
            <SearchableSelect
              id="biz-apps-industry"
              value={industry}
              onChange={onSelectIndustry}
              options={presets.map((p) => ({
                value: p.key,
                label: t(`bizonb.ind_${p.key}`, { defaultValue: p.label }),
              }))}
              searchThreshold={20}
            />
          </div>
        )}
      </div>
      <div className="mb-3 flex items-center justify-between gap-3 px-1 text-xs text-content-tertiary">
        <span aria-live="polite">
          {t('bizonb.apps_selected', {
            defaultValue: '{{count}} of {{total}} apps selected',
            count,
            total: ALL_APP_KEYS.length,
          })}
        </span>
        <button
          type="button"
          onClick={onReset}
          disabled={isRecommendedSet}
          className="inline-flex items-center gap-1 font-medium text-oe-blue hover:underline disabled:cursor-default disabled:text-content-tertiary disabled:no-underline"
        >
          <RotateCcw size={12} />
          {t('bizonb.apps_reset', { defaultValue: 'Reset to recommended' })}
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="rounded-xl bg-surface-elevated px-4 py-8 text-center text-sm text-content-tertiary ring-1 ring-border-light">
          {t('bizonb.apps_no_match', { defaultValue: 'No apps match your search' })}
        </p>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {groups.map((group) => {
            const onInGroup = group.keys.filter((k) => enabled.has(k)).length;
            const allOn = onInGroup === group.keys.length;
            return (
              <section key={group.id} className="rounded-xl bg-surface-elevated p-3 ring-1 ring-border-light">
                <header className="mb-1 flex items-center justify-between gap-2 px-2 py-1">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
                    {t(`bizonb.group_${group.id}`, { defaultValue: group.label })}
                    <span className="ms-2 font-normal tabular-nums tracking-normal text-content-tertiary">
                      {onInGroup}/{group.keys.length}
                    </span>
                  </h2>
                  <button
                    type="button"
                    onClick={() => onSetMany(group.keys, !allOn)}
                    className="text-xs font-medium text-oe-blue hover:underline"
                  >
                    {allOn
                      ? t('bizonb.apps_clear_group', { defaultValue: 'Clear' })
                      : t('bizonb.apps_select_group', { defaultValue: 'Select all' })}
                  </button>
                </header>
                <ul>
                  {group.visible.map((key) => (
                    <li key={key}>
                      <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-surface-secondary">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 rounded accent-oe-blue"
                          checked={enabled.has(key)}
                          onChange={() => onToggle(key)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-content-primary">
                            {appLabel(key)}
                            {recommended.has(key) && (
                              <span className="rounded bg-oe-blue-subtle px-1.5 py-px text-2xs font-medium text-oe-blue">
                                {t('bizonb.apps_recommended', { defaultValue: 'Recommended' })}
                              </span>
                            )}
                          </span>
                          <span className="block text-xs leading-snug text-content-tertiary">{appDesc(key)}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <Footer
        onBack={onBack}
        onNext={onNext}
        nextDisabled={count === 0}
        nextLabel={t('bizonb.apps_next', { defaultValue: 'Continue with {{count}} apps', count })}
      />
    </div>
  );
}

function StepLaunch({
  form,
  industryLabel,
  appCount,
  busy,
  phase,
  error,
  sampleCase,
  loadSample,
  onLoadSample,
  onBack,
  onLaunch,
}: {
  form: CompanyForm;
  industryLabel: string;
  appCount: number;
  busy: boolean;
  phase: 'saving' | 'sample' | null;
  error: string | null;
  sampleCase: BusinessDemoCase | null;
  loadSample: boolean;
  onLoadSample: (v: boolean) => void;
  onBack: () => void;
  onLaunch: () => void;
}) {
  const { t } = useTranslation();
  const country = getCountry(form.country_code);
  const rows: [string, ReactNode][] = [
    [t('bizonb.company_name', { defaultValue: 'Company name' }), form.company_name],
    [
      t('bizonb.country', { defaultValue: 'Country' }),
      <span key="c" className="inline-flex items-center gap-2">
        <CountryFlag code={form.country_code} size={16} />
        {country?.name ?? form.country_code}
      </span>,
    ],
    [t('bizonb.currency', { defaultValue: 'Base currency' }), form.base_currency],
    [t('bizonb.step_industry', { defaultValue: 'Industry' }), industryLabel],
    [t('bizonb.step_apps', { defaultValue: 'Apps' }), String(appCount)],
  ];
  return (
    <div>
      <StepHeader
        eyebrow={t('bizonb.step_launch', { defaultValue: 'Launch' })}
        title={t('bizonb.launch_title', { defaultValue: 'Ready to go' })}
      />
      <div className="grid items-start gap-4 md:grid-cols-5">
        <dl className="md:col-span-3 divide-y divide-border-light rounded-xl bg-surface-elevated ring-1 ring-border-light">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
              <dt className="text-content-tertiary">{k}</dt>
              <dd className="font-medium text-content-primary text-end">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="md:col-span-2 rounded-xl bg-surface-elevated p-4 ring-1 ring-border-light">
          <div className="flex items-center gap-2 text-sm font-semibold text-content-primary">
            <Command size={16} className="text-content-secondary" />
            {t('bizonb.ai_title', { defaultValue: 'Do it from the keyboard' })}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-content-secondary">
            {t('bizonb.ai_body', {
              defaultValue:
                'Ctrl+K opens the command bar. Type "new invoice", a customer name or a question about your numbers. Drafts are always shown before anything is saved.',
            })}
          </p>
        </div>
      </div>
      {sampleCase && (
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-surface-elevated p-4 ring-1 ring-border-light">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border accent-oe-blue"
            checked={loadSample}
            disabled={busy}
            onChange={(e) => onLoadSample(e.target.checked)}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-content-primary">
              {t('bizonb.sample_label', {
                defaultValue: 'Load sample data for {{company}}',
                company: sampleCase.company,
              })}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-content-secondary">
              {t('bizonb.sample_hint', {
                defaultValue: 'Customers, invoices, stock and a ledger to look around with. You can remove it or add more in Settings.',
              })}
            </span>
          </span>
        </label>
      )}
      {busy && phase && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-content-secondary">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-oe-blue" />
          {phase === 'sample'
            ? t('bizonb.sample_loading', { defaultValue: 'Loading sample data. This takes a few seconds.' })
            : t('bizonb.saving', { defaultValue: 'Saving your setup' })}
        </p>
      )}
      {error && <p className="mt-4 text-sm text-semantic-error">{error}</p>}
      <Footer
        onBack={onBack}
        onNext={onLaunch}
        busy={busy}
        nextLabel={t('bizonb.launch', { defaultValue: 'Open my workspace' })}
      >
      </Footer>
    </div>
  );
}

// ── Wizard ──────────────────────────────────────────────────────────────────

function withDeps(keys: Iterable<string>): Set<string> {
  const out = new Set(keys);
  for (const key of [...out]) for (const dep of APP_DEPENDS[key] ?? []) out.add(dep);
  return out;
}

export function BusinessOnboarding() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const onboardingQueryKey = useMeOnboardingQueryKey();
  const syncFromServer = useModuleStore((s) => s.syncFromServer);
  const setPreferences = usePreferencesStore((s) => s.setPreferences);
  const isAdmin = normalizeRole(useAuthStore((s) => s.userRole)) === 'admin';

  const [alreadyCompleted] = useState(() => isOnboardingCompleted());
  useEffect(() => {
    if (alreadyCompleted) navigate('/', { replace: true });
  }, [alreadyCompleted, navigate]);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CompanyForm>(() => {
    const country = getCountry(detectCountry() ?? '');
    return {
      company_name: '',
      country_code: country?.code ?? '',
      base_currency: country?.currency ?? '',
      fiscal_year_start_month: 1,
      company_size: 'small',
    };
  });
  const [industry, setIndustry] = useState('');
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presetsQuery = useQuery({
    queryKey: ['onboarding-presets'],
    queryFn: () => apiGet<Preset[]>('/v1/users/onboarding-presets/'),
    staleTime: Infinity,
  });
  const businessPresets = useMemo(
    () => (presetsQuery.data ?? []).filter((p) => p.pack === 'business'),
    [presetsQuery.data],
  );
  const selectedPreset = businessPresets.find((p) => p.key === industry);

  const recommended = useMemo(
    () => new Set(selectedPreset?.recommended_modules ?? selectedPreset?.enabled_modules ?? []),
    [selectedPreset],
  );

  const selectIndustry = useCallback(
    (key: string) => {
      setIndustry(key);
      const preset = businessPresets.find((p) => p.key === key);
      if (preset) setEnabled(withDeps(preset.recommended_modules ?? preset.enabled_modules));
    },
    [businessPresets],
  );

  const toggleApp = useCallback((key: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        // Switching a dependency off takes its dependents with it.
        for (const [mod, deps] of Object.entries(APP_DEPENDS)) if (deps.includes(key)) next.delete(mod);
        return next;
      }
      next.add(key);
      return withDeps(next);
    });
  }, []);

  const setMany = useCallback((keys: string[], on: boolean) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (on) next.add(key);
        else {
          next.delete(key);
          for (const [mod, deps] of Object.entries(APP_DEPENDS)) if (deps.includes(key)) next.delete(mod);
        }
      }
      return on ? withDeps(next) : next;
    });
  }, []);

  const appCount = ALL_APP_KEYS.filter((k) => enabled.has(k)).length;

  const [loadSample, setLoadSample] = useState(true);
  const [phase, setPhase] = useState<'saving' | 'sample' | null>(null);
  const demoCases = useQuery({
    queryKey: ['business-demo', 'cases'],
    queryFn: fetchBusinessDemoCases,
    enabled: step === STEP_COUNT - 1 && isAdmin,
    retry: false,
  });
  const sampleCase = demoCases.data?.find((c) => c.key === industry) ?? null;

  const launch = useCallback(async () => {
    setBusy(true);
    setError(null);
    setPhase('saving');
    try {
      if (isAdmin) {
        await apiPut('/v1/business-settings/', { ...form, industry });
        await apiPut('/v1/company-profile/', { legal_name: form.company_name }).catch(() => undefined);
      }
      await apiPatch('/v1/users/me/preferences/', { currency_code: form.base_currency }).catch(() => undefined);
      setPreferences({ currency: form.base_currency, defaultCurrency: form.base_currency });
      const modules = [...new Set([...enabled, ...SYSTEM_KEYS])];
      // The industry is always sent: it selects the business pack server-side, so a
      // hand-edited set does not fall back to the construction core.
      const saved = await apiPost('/v1/users/me/onboarding/', {
        company_type: industry || null,
        enabled_modules: modules,
        completed: true,
      });
      queryClient.setQueryData(onboardingQueryKey, saved);
      await syncFromServer();
      markOnboardingCompleted();
      if (isAdmin && sampleCase && loadSample) {
        // Saving may already have seeded this case (server demo seed); only install what is missing.
        setPhase('sample');
        try {
          const fresh = await fetchBusinessDemoCases();
          if (!fresh.find((c) => c.key === sampleCase.key)?.installed) await installBusinessDemoCase(sampleCase.key);
          await queryClient.invalidateQueries();
        } catch {
          // The workspace is ready; sample data can be loaded later from Settings.
        }
      }
      navigate('/');
    } catch {
      setError(t('bizonb.launch_error', { defaultValue: 'Could not save your setup. Check the connection and try again.' }));
    } finally {
      setBusy(false);
      setPhase(null);
    }
  }, [enabled, form, industry, isAdmin, loadSample, sampleCase, navigate, onboardingQueryKey, queryClient, setPreferences, syncFromServer, t]);

  if (alreadyCompleted) return null;

  return (
    <div className="flex min-h-screen flex-col bg-surface-primary">
      <header className="sticky top-0 z-10 border-b border-border-light bg-surface-primary/85 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-4xl px-6 py-4">
          <Progress step={step} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        {step === 0 && <StepLanguage onNext={() => setStep(1)} />}
        {step === 1 && (
          <StepCompany
            form={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <StepIndustry
            presets={businessPresets}
            loading={presetsQuery.isLoading}
            selected={industry}
            onSelect={selectIndustry}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <StepApps
            enabled={enabled}
            recommended={recommended}
            presets={businessPresets}
            industry={industry}
            onSelectIndustry={selectIndustry}
            onToggle={toggleApp}
            onSetMany={setMany}
            onReset={() => selectIndustry(industry)}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
          />
        )}
        {step === STEP_COUNT - 1 && (
          <StepLaunch
            form={form}
            industryLabel={selectedPreset ? t(`bizonb.ind_${selectedPreset.key}`, { defaultValue: selectedPreset.label }) : ''}
            appCount={appCount}
            busy={busy}
            phase={phase}
            error={error}
            sampleCase={sampleCase}
            loadSample={loadSample}
            onLoadSample={setLoadSample}
            onBack={() => setStep(3)}
            onLaunch={launch}
          />
        )}
      </main>
      <footer className="pb-4 text-center text-2xs text-content-tertiary">
        {t('bizonb.footer', { defaultValue: 'Open source · Your data stays on your server · AGPL-3.0' })}
      </footer>
    </div>
  );
}
