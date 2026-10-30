import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  BookOpen,
  Boxes,
  Brain,
  CreditCard,
  FileText,
  FolderKanban,
  Layers,
  Package,
  Plug,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserRound,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { SUPPORTED_LANGUAGES } from '@/app/i18n';
import { HEX_PORTRAIT_ASPECT, HEX_PORTRAIT_CLIP } from '@/shared/lib/honeycomb';
import { fmtFixed } from '@/shared/lib/formatters';

interface Cell { x: number; y: number; icon: LucideIcon; key: string; label: string; center?: boolean }

// Pointy-top hex grid: 88px column step, 76px row stride, odd rows offset by half a cell.
const CELLS: Cell[] = [
  { x: -220, y: -76, icon: ShieldCheck, key: 'local', label: 'Self-hosted' },
  { x: -132, y: -76, icon: Brain, key: 'ai', label: 'AI' },
  { x: -44, y: -76, icon: Users, key: 'crm', label: 'CRM' },
  { x: 44, y: -76, icon: FileText, key: 'quote', label: 'Quote' },
  { x: 132, y: -76, icon: ShoppingCart, key: 'order', label: 'Order' },
  { x: 220, y: -76, icon: Truck, key: 'delivery', label: 'Delivery' },
  { x: -176, y: 0, icon: Package, key: 'purchasing', label: 'Purchasing' },
  { x: -88, y: 0, icon: Boxes, key: 'stock', label: 'Stock' },
  { x: 0, y: 0, icon: Layers, key: 'core', label: 'Workspace', center: true },
  { x: 88, y: 0, icon: Receipt, key: 'invoice', label: 'Invoice' },
  { x: 176, y: 0, icon: CreditCard, key: 'payment', label: 'Payment' },
  { x: -220, y: 76, icon: Zap, key: 'realtime', label: 'Realtime' },
  { x: -132, y: 76, icon: UserRound, key: 'people', label: 'People' },
  { x: -44, y: 76, icon: FolderKanban, key: 'projects', label: 'Projects' },
  { x: 44, y: 76, icon: BookOpen, key: 'ledger', label: 'Ledger' },
  { x: 132, y: 76, icon: BarChart3, key: 'reports', label: 'Reports' },
  { x: 220, y: 76, icon: Plug, key: 'integrations', label: 'Integrations' },
];

/** Order-to-cash, the path the highlight walks across the grid. */
const FLOW = ['crm', 'quote', 'order', 'delivery', 'invoice', 'payment', 'ledger', 'reports'];

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

// Deterministic ledger figures so the backdrop is identical on every render.
const LEDGER = Array.from({ length: 28 }, (_, i) => {
  const n = (i * 7919 + 104729) % 99991;
  return {
    acct: String(1000 + ((i * 37) % 90) * 10),
    debit: (n % 9000) + 120 + (n % 100) / 100,
    credit: ((n * 3) % 7000) + 80 + ((n * 7) % 100) / 100,
  };
});

/** Light backdrop: fine ruled grid, a slowly scrolling ledger and a few drafting-style circles. */
function ShowcaseBackdrop() {
  const rows = [...LEDGER, ...LEDGER];
  const fade = 'radial-gradient(ellipse 75% 70% at 60% 45%, #000 30%, transparent 85%)';
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-[#f7f8fb]" aria-hidden>
      <div
        className="absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(23,71,214,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(23,71,214,0.07) 1px, transparent 1px),' +
            'linear-gradient(to right, rgba(23,71,214,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(23,71,214,0.05) 1px, transparent 1px)',
          backgroundSize: '120px 120px, 120px 120px, 24px 24px, 24px 24px',
          maskImage: fade,
          WebkitMaskImage: fade,
        }}
      />
      <div
        className="absolute -right-6 top-0 h-full w-[420px] overflow-hidden opacity-[0.22]"
        style={{ maskImage: 'linear-gradient(to bottom, transparent, #000 20%, #000 80%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 20%, #000 80%, transparent)' }}
      >
        <div className="obe-ledger font-mono text-[11px] leading-[28px] text-[#1747d6]">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[60px_minmax(0,1fr)_minmax(0,1fr)] gap-6 border-b border-[#1747d6]/20 px-4 tabular-nums">
              <span>{r.acct}</span>
              <span className="text-end">{fmtFixed(r.debit)}</span>
              <span className="text-end">{i % 3 ? fmtFixed(r.credit) : ''}</span>
            </div>
          ))}
        </div>
      </div>
      <svg className="absolute -right-40 -top-40 h-[640px] w-[640px] text-[#1747d6] opacity-[0.16]" viewBox="0 0 640 640" fill="none" stroke="currentColor">
        <g className="obe-spin">
          <circle cx="320" cy="320" r="300" strokeDasharray="2 6" />
          <circle cx="320" cy="320" r="220" />
          <circle cx="320" cy="320" r="140" strokeDasharray="1 4" />
          <line x1="20" y1="320" x2="620" y2="320" />
          <line x1="320" y1="20" x2="320" y2="620" />
          <line x1="108" y1="108" x2="532" y2="532" strokeDasharray="3 5" />
        </g>
      </svg>
      <svg className="absolute -bottom-24 left-[-60px] h-[360px] w-[360px] text-[#1747d6] opacity-[0.14]" viewBox="0 0 360 360" fill="none" stroke="currentColor">
        <rect x="40" y="40" width="280" height="280" />
        <rect x="90" y="90" width="180" height="180" transform="rotate(45 180 180)" />
        <circle cx="180" cy="180" r="90" strokeDasharray="2 5" />
      </svg>
      <div className="obe-orb-a absolute right-[12%] top-[10%] h-[380px] w-[380px] rounded-full bg-[#5b8cff]/15 blur-[110px]" />
      <div className="obe-orb-b absolute bottom-[8%] left-[10%] h-[320px] w-[320px] rounded-full bg-sky-200/40 blur-[100px]" />
    </div>
  );
}

/** Right half of the sign-in page: what the product covers, with order-to-cash walking the module grid. */
export function LoginShowcase() {
  const { t } = useTranslation();
  const [step, setStep] = useState(-1);

  useEffect(() => {
    if (reducedMotion()) return;
    // One extra tick past the last step leaves the finished path visible before it restarts.
    const id = window.setInterval(() => setStep((s) => (s >= FLOW.length ? 0 : s + 1)), 900);
    return () => window.clearInterval(id);
  }, []);

  const flowPos = (key: string) => FLOW.indexOf(key);
  const label = (c: Cell) => t(`login.biz_mod_${c.key}`, { defaultValue: c.label });

  return (
    <aside className="hidden lg:flex relative z-10 lg:order-2 bg-[#f7f8fb] [color-scheme:light] flex-col justify-center overflow-hidden pl-14 xl:pl-20 pr-12 xl:pr-16 py-8">
      <style>{`
        @keyframes obe-ledger { from { transform: translateY(0) } to { transform: translateY(-50%) } }
        .obe-ledger { animation: obe-ledger 60s linear infinite }
        @keyframes obe-spin { to { transform: rotate(360deg) } }
        .obe-spin { animation: obe-spin 120s linear infinite; transform-origin: center }
        @keyframes obe-drift-a { 0%,100% { transform: translate3d(0,0,0) scale(1) } 50% { transform: translate3d(30px,-22px,0) scale(1.08) } }
        @keyframes obe-drift-b { 0%,100% { transform: translate3d(0,0,0) scale(1) } 50% { transform: translate3d(-26px,28px,0) scale(0.94) } }
        @keyframes obe-drift-c { 0%,100% { transform: translate3d(0,0,0) scale(1) } 50% { transform: translate3d(20px,32px,0) scale(1.05) } }
        .obe-orb-a { animation: obe-drift-a 12s ease-in-out infinite }
        .obe-orb-b { animation: obe-drift-b 14s ease-in-out infinite }
        .obe-orb-c { animation: obe-drift-c 10s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) { .obe-orb-a, .obe-orb-b, .obe-orb-c, .obe-ledger, .obe-spin { animation: none } }
      `}</style>

      <ShowcaseBackdrop />

      <div className="mb-5">
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/[0.08] px-3.5 py-1.5">
          <span className="relative flex h-[6px] w-[6px]">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-[6px] w-[6px] rounded-full bg-emerald-500" />
          </span>
          <span className="text-[11px] font-medium tracking-[0.04em] text-emerald-700">
            {t('login.biz_eyebrow', { defaultValue: 'Open-source ERP' })}
          </span>
        </span>
      </div>

      <h2 className="max-w-[560px] text-[32px] xl:text-[38px] font-semibold leading-[1.08] tracking-[-0.025em] text-slate-900">
        {t('login.biz_h_a', { defaultValue: 'Sales, purchasing, stock and finance' })}{' '}
        <span className="bg-gradient-to-r from-oe-blue to-sky-500 bg-clip-text text-transparent">
          {t('login.biz_h_b', { defaultValue: 'in one system' })}
        </span>
      </h2>

      <p className="mt-5 max-w-[440px] text-[16px] leading-[1.65] tracking-[-0.008em] text-slate-600">
        {t('login.biz_desc', {
          defaultValue: 'Built for companies of 1 to 1,000 people. Self-hosted or in the cloud, in your language and currency.',
        })}
      </p>

      <div className="mt-6 flex items-center gap-7">
        {[
          { value: String(SUPPORTED_LANGUAGES.length), label: t('login.stat_langs', { defaultValue: 'languages' }) },
          { value: '150+', label: t('login.biz_stat_currencies', { defaultValue: 'currencies' }) },
          { value: 'IFRS', label: t('login.biz_stat_gaap', { defaultValue: '+ local GAAP' }) },
          { value: '1–1000', label: t('login.biz_stat_team', { defaultValue: 'people' }) },
        ].map((s) => (
          <div key={s.label}>
            <div className="text-[22px] font-semibold tracking-tight tabular-nums text-slate-900">{s.value}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 mt-6 h-px max-w-[560px] bg-gradient-to-r from-black/[0.06] via-black/[0.1] to-transparent" />

      <div className="relative mr-auto h-[268px] w-[560px] max-w-full overflow-hidden" aria-hidden>
        {CELLS.map((cell) => {
          const pos = flowPos(cell.key);
          const active = pos !== -1 && pos === step;
          const done = pos !== -1 && pos < step;
          const lit = cell.center || active;
          const Icon = cell.icon;
          return (
            <div
              key={cell.key}
              className="absolute left-1/2 top-1/2"
              style={{ transform: `translate(calc(-50% + ${cell.x}px), calc(-50% + ${cell.y}px))` }}
            >
              <div
                className={`relative flex w-[88px] flex-col items-center justify-center transition-[background,box-shadow,transform] duration-500 ${
                  active ? 'scale-[1.06]' : ''
                } ${lit ? 'text-white' : 'text-slate-900'}`}
                style={{
                  aspectRatio: HEX_PORTRAIT_ASPECT,
                  clipPath: HEX_PORTRAIT_CLIP,
                  background: lit
                    ? 'linear-gradient(135deg, #3b6cf0 0%, #1747d6 60%, #1238a8 100%)'
                    : done
                      ? 'linear-gradient(180deg, rgba(234,240,255,0.98), rgba(214,226,255,0.9))'
                      : 'linear-gradient(180deg, rgba(255,255,255,0.97), rgba(244,247,255,0.82))',
                }}
              >
                <Icon
                  size={lit ? 22 : 18}
                  strokeWidth={lit ? 2 : 1.65}
                  className={lit ? '' : 'text-oe-blue'}
                />
                <span className={`mt-[5px] text-[10px] font-semibold tracking-[-0.01em] ${lit ? 'text-white/95' : 'text-slate-800'}`}>
                  {label(cell)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 flex h-4 items-center gap-2 text-[11.5px] text-slate-500">
        <span className="font-medium text-slate-600">{t('login.biz_flow', { defaultValue: 'Order to cash' })}</span>
        <span className="tabular-nums">
          {FLOW.map((k, i) => (
            <span key={k} className={i <= step ? 'text-oe-blue' : ''}>
              {t(`login.biz_mod_${k}`, { defaultValue: CELLS.find((c) => c.key === k)!.label })}
              {i < FLOW.length - 1 && <span className="mx-1 text-slate-400">→</span>}
            </span>
          ))}
        </span>
      </p>

      <div className="mt-7 flex flex-wrap items-start gap-x-6 gap-y-2">
        {[
          {
            icon: BookOpen,
            title: t('login.biz_feat_books_title', { defaultValue: 'Every document posts itself' }),
            desc: t('login.biz_feat_books', { defaultValue: 'Invoices and payments land in a double-entry ledger, ready for your accountant.' }),
          },
          {
            icon: Brain,
            title: t('login.feat_ai_title', { defaultValue: 'AI-assisted, human-confirmed' }),
            desc: t('login.biz_feat_ai', { defaultValue: 'Agents draft quotes, orders and reminders. Nothing is saved until you confirm.' }),
          },
        ].map((feat) => {
          const Icon = feat.icon;
          return (
            <div key={feat.title} className="relative max-w-[230px] pl-4">
              <span aria-hidden className="absolute left-0 top-1 h-[14px] w-[2px] rounded-full bg-gradient-to-b from-oe-blue to-sky-500/60" />
              <div className="flex items-center gap-1.5">
                <Icon size={13} strokeWidth={1.8} className="text-oe-blue/85" />
                <span className="text-[12.5px] font-semibold leading-tight tracking-[-0.01em] text-slate-900">{feat.title}</span>
              </div>
              <p className="mt-1 text-[11.5px] leading-[1.55] tracking-[-0.005em] text-slate-500">{feat.desc}</p>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-[11px] text-slate-400">
        {t('login.biz_footer', { defaultValue: 'AGPL-3.0 · Your data stays on your server' })}
      </p>
    </aside>
  );
}
