import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Banknote, CheckCircle2, Circle, Clock, Search, Settings2, ShoppingCart, Truck, Wrench } from 'lucide-react';
import { Breadcrumb } from '@/shared/ui/Breadcrumb';
import { Card } from '@/shared/ui/Card';
import { DismissibleInfo } from '@/shared/ui/DismissibleInfo';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ModuleGuideButton } from '@/shared/ui/ModuleGuideButton';
import { PageHeader } from '@/shared/ui/PageHeader';
import { businessCasesGuide } from './businessCasesGuide';
import { useCompanyPresetKey } from '@/app/layout/useCompanyWorkspace';
import {
  BIZ_DISCIPLINES, BIZ_SECTIONS, BUSINESS_CASES, caseMatches, loadProgress, saveProgress, sectionOf,
  type BizCase, type BizDiscipline, type BizSection,
} from './businessCases';

const ICONS: Record<BizDiscipline, typeof Settings2> = {
  setup: Settings2, sales: ShoppingCart, purchasing: Truck, finance: Banknote, operations: Wrench,
};
const DISC_LABEL: Record<BizDiscipline, string> = {
  setup: 'Setup', sales: 'Sales', purchasing: 'Purchasing', finance: 'Finance', operations: 'Operations',
};
const SECTION_LABEL: Record<BizSection, string> = {
  trade: 'Trade & production', services: 'Services', health: 'Health & beauty', hospitality: 'Hospitality & leisure', public: 'Education & nonprofit',
};

function useProgress() {
  const [progress, setProgress] = useState(loadProgress);
  const toggle = (id: string, step: number) => setProgress((prev) => {
    const done = new Set(prev[id] ?? []);
    if (done.has(step)) done.delete(step); else done.add(step);
    const next = { ...prev, [id]: [...done] };
    saveProgress(next);
    return next;
  });
  return { progress, toggle };
}

export function BusinessCasesHub({ caseId }: { caseId?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const preset = useCompanyPresetKey();
  const [section, setSection] = useState<BizSection | null>(() => sectionOf(preset));
  const touched = useRef(false);
  useEffect(() => { if (!touched.current) setSection(sectionOf(preset)); }, [preset]);
  const [disc, setDisc] = useState<BizDiscipline | null>(null);
  const [q, setQ] = useState('');
  const { progress, toggle } = useProgress();

  const tr = (c: BizCase, f: 'title' | 'summary') => t(`bizcases.${c.id}.${f}`, { defaultValue: c[f] });

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return BUSINESS_CASES.filter((c) => caseMatches(c, section) && (!disc || c.discipline === disc)
      && (!needle || `${c.title} ${c.summary}`.toLowerCase().includes(needle)));
  }, [section, disc, q]);

  const open = caseId ? BUSINESS_CASES.find((c) => c.id === caseId) : undefined;
  if (open) {
    const done = new Set(progress[open.id] ?? []);
    return (
      <div className="space-y-5">
        <Breadcrumb
          items={[
            { label: t('bizcases.back', { defaultValue: 'All cases' }), to: '/cases' },
            { label: tr(open, 'title') },
          ]}
        />
        <PageHeader
          srTitle={t('nav.cases', { defaultValue: 'Cases' })}
          subtitle={tr(open, 'summary')}
          actions={<ModuleGuideButton content={businessCasesGuide} />}
        />
        <h2 className="text-lg font-semibold text-content-primary">
          {tr(open, 'title')}
          <span className="ml-3 text-xs font-normal text-content-tertiary">{done.size}/{open.steps.length} · {open.minutes} min</span>
        </h2>
        <ol className="max-w-3xl space-y-3">
          {open.steps.map((s, i) => (
            <li key={i} className="flex gap-3 rounded-xl border border-border-light bg-surface-elevated p-4">
              <button type="button" onClick={() => toggle(open.id, i)} aria-pressed={done.has(i)}
                aria-label={t('bizcases.mark_done', { defaultValue: 'Mark step done' })} className="mt-0.5 shrink-0 text-oe-blue">
                {done.has(i) ? <CheckCircle2 size={20} /> : <Circle size={20} className="text-content-tertiary" />}
              </button>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-content-primary">{i + 1}. {t(`bizcases.${open.id}.s${i}.title`, { defaultValue: s.title })}</h3>
                <p className="mt-1 text-sm text-content-secondary">{t(`bizcases.${open.id}.s${i}.body`, { defaultValue: s.body })}</p>
                <p className="mt-1 text-xs text-content-tertiary">
                  {t('bizcases.look_for', { defaultValue: 'What to look for:' })} {t(`bizcases.${open.id}.s${i}.look`, { defaultValue: s.look })}
                </p>
              </div>
              <Link to={s.route} className="inline-flex h-8 shrink-0 items-center gap-1 self-center rounded-md border border-border-light px-3 text-xs font-medium text-content-primary hover:bg-surface-secondary">
                {t('bizcases.open', { defaultValue: 'Open' })} <ArrowRight size={12} />
              </Link>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium ${active ? 'border-oe-blue bg-oe-blue text-white' : 'border-border-light text-content-secondary hover:bg-surface-secondary'}`;

  return (
    <div className="space-y-5">
      <PageHeader
        srTitle={t('nav.cases', { defaultValue: 'Cases' })}
        subtitle={t('bizcases.subtitle', { defaultValue: 'Short step-by-step walkthroughs of everyday tasks, each step opening the right screen.' })}
        actions={<ModuleGuideButton content={businessCasesGuide} onCta={() => setDisc(null)} />}
      />
      <DismissibleInfo
        storageKey="bizcases"
        title={t('bizcases.intro_title', { defaultValue: 'Learn by doing' })}
        links={[
          { label: t('bizcases.intro_link_sales', { defaultValue: 'Sales' }), onClick: () => navigate('/sales') },
          { label: t('bizcases.intro_link_accounting', { defaultValue: 'Accounting' }), onClick: () => navigate('/accounting') },
          { label: t('bizcases.intro_link_import', { defaultValue: 'Import data' }), onClick: () => navigate('/import') },
        ]}
      >
        {t('bizcases.intro_body', {
          defaultValue:
            'Pick a walkthrough for the kind of business you run. Every step opens the matching screen, tells you what to look for and remembers your progress on this device.',
        })}
      </DismissibleInfo>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-content-secondary" htmlFor="bizcases-section">{t('bizcases.i_run', { defaultValue: 'I run a…' })}</label>
        <select id="bizcases-section" value={section ?? ''} onChange={(e) => { touched.current = true; setSection((e.target.value || null) as BizSection | null); }}
          className="h-9 rounded-lg border border-border bg-surface-primary px-3 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue">
          <option value="">{t('bizcases.any_business', { defaultValue: 'Any business' })}</option>
          {(Object.keys(BIZ_SECTIONS) as BizSection[]).map((s) => (
            <option key={s} value={s}>{t(`bizcases.section_${s}`, { defaultValue: SECTION_LABEL[s] })}</option>
          ))}
        </select>
        <div className="relative ml-auto min-w-[200px] max-w-md flex-1">
          <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-content-tertiary" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('bizcases.search', { defaultValue: 'Search cases' })}
            className="h-9 w-full rounded-lg border border-border bg-surface-primary ps-8 pe-3 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={chip(disc === null)} onClick={() => setDisc(null)}>{t('bizcases.all', { defaultValue: 'All' })}</button>
        {BIZ_DISCIPLINES.map((d) => (
          <button key={d} type="button" className={chip(disc === d)} onClick={() => setDisc(d)}>
            {t(`bizcases.disc_${d}`, { defaultValue: DISC_LABEL[d] })}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Card padding="none"><EmptyState icon={<Search size={22} />} title={t('bizcases.none', { defaultValue: 'No cases match these filters.' })} /></Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => {
            const Icon = ICONS[c.discipline];
            const n = (progress[c.id] ?? []).length;
            return (
              <li key={c.id}>
                <Link to={`/cases/${c.id}`} className="flex h-full flex-col gap-2 rounded-xl border border-border-light bg-surface-elevated p-4 transition-colors hover:bg-surface-secondary">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-secondary text-content-secondary"><Icon size={16} /></span>
                    <span className="text-xs text-content-tertiary">{t(`bizcases.disc_${c.discipline}`, { defaultValue: DISC_LABEL[c.discipline] })}</span>
                  </div>
                  <h3 className="text-sm font-semibold text-content-primary">{tr(c, 'title')}</h3>
                  <p className="flex-1 text-xs text-content-secondary">{tr(c, 'summary')}</p>
                  <div className="flex items-center gap-3 text-xs text-content-tertiary">
                    <span className="inline-flex items-center gap-1"><Clock size={12} /> {c.minutes} min</span>
                    <span>{n}/{c.steps.length}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
