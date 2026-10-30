import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCheck, Keyboard, Search, Settings2, Wand2 } from 'lucide-react';
import { Button, Card } from '@/shared/ui';
import { getErrorMessage } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { bankingApi, type BankAccount, type BankRuleInput, type BankTransaction } from '../api';
import { keyAction } from '../logic';
import { draftProblem, draftsFromSuggestion, type DraftAlloc } from '../reconcile';
import { inputCls } from '../modals/AccountFormModal';
import { ruleFromLine } from '../modals/RuleFormModal';
import { BankLineList } from './BankLineList';
import { MatchPanel } from './MatchPanel';

const OPEN_FILTER = 'unmatched,partially_matched';

interface Props {
  accounts: BankAccount[];
  accountId: string;
  onAccount: (id: string) => void;
  onImport: () => void;
  onBulk: () => void;
  onSettings: () => void;
  onNewRule: (initial: BankRuleInput) => void;
  writeOffMax: number;
}

export function ReconcileWorkspace({ accounts, accountId, onAccount, onImport, onBulk, onSettings, onNewRule, writeOffMax }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [filter, setFilter] = useState(OPEN_FILTER);
  const [search, setSearch] = useState('');
  const [index, setIndex] = useState(0);
  const [pick, setPick] = useState(0);
  const [drafts, setDrafts] = useState<DraftAlloc[]>([]);
  const [writeOff, setWriteOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = useQuery({
    queryKey: ['banking', 'lines', filter, accountId],
    queryFn: () => bankingApi.transactions(accountId || undefined, filter),
  });
  const items = useQuery({ queryKey: ['banking', 'open-items'], queryFn: bankingApi.openItems });
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = lines.data ?? [];
    if (!q) return all;
    return all.filter((r) =>
      [r.counterparty_name, r.remittance, r.reference, r.counterparty_iban, r.amount].some((v) => v.toLowerCase().includes(q)),
    );
  }, [lines.data, search]);
  const current: BankTransaction | undefined = rows[Math.min(index, Math.max(rows.length - 1, 0))];
  const isOpen = !!current && (current.status === 'unmatched' || current.status === 'partially_matched');
  const sugg = useQuery({
    queryKey: ['banking', 'suggestions', current?.id, current?.matched_amount],
    queryFn: () => bankingApi.suggestions(current!.id),
    enabled: isOpen,
  });
  const rule = useQuery({
    queryKey: ['banking', 'rule-for', current?.id],
    queryFn: () => bankingApi.ruleFor(current!.id),
    enabled: isOpen && current?.status === 'unmatched',
  });
  const suggestions = useMemo(() => (isOpen ? sugg.data ?? [] : []), [isOpen, sugg.data]);

  // Reset the working state whenever another line comes into focus.
  useEffect(() => {
    setPick(0);
    setWriteOff(false);
    setError(null);
  }, [current?.id]);
  // The selected suggestion seeds the allocation editor; the user can then split or trim it.
  useEffect(() => {
    const s = suggestions[pick];
    setDrafts(s ? draftsFromSuggestion(s, items.data ?? []) : []);
  }, [suggestions, pick, items.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['banking'] });
  const onError = (e: unknown) => setError(getErrorMessage(e));
  const done = (title: string) => {
    refresh();
    addToast({ type: 'success', title });
  };
  const confirm = useMutation({
    mutationFn: () => bankingApi.confirm(current!.id, drafts, writeOff, suggestions[pick]?.score),
    onSuccess: () => done(t('banking.matched_toast', { defaultValue: 'Line matched' })),
    onError,
  });
  const undo = useMutation({
    mutationFn: () => bankingApi.undo(current!.id),
    onSuccess: () => done(t('banking.undone_toast', { defaultValue: 'Match undone' })),
    onError,
  });
  const ignore = useMutation({
    mutationFn: () => bankingApi.ignore(current!.id, current!.status !== 'ignored'),
    onSuccess: refresh,
    onError,
  });
  const manual = useMutation({
    mutationFn: (v: { code: string; memo: string; amount: string }) => bankingApi.manualEntry(current!.id, v.code, v.memo, v.amount),
    onSuccess: () => done(t('banking.booked_toast', { defaultValue: 'Line booked' })),
    onError,
  });
  const applyRules = useMutation({
    mutationFn: () => bankingApi.applyRules(false, accountId || undefined),
    onSuccess: (r) => done(t('banking.rules_applied', { defaultValue: '{{n}} lines booked by rules', n: r.applied })),
    onError: (e) => addToast({ type: 'error', title: getErrorMessage(e) }),
  });

  const canConfirm = isOpen && !draftProblem(drafts, Math.abs(Number(current!.amount)) - Number(current!.matched_amount));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY'].includes(el.tagName) || el.isContentEditable)) {
        if (el.tagName !== 'BUTTON' || e.key === 'Enter') return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      const act = keyAction(e.key, index, rows.length);
      if (act.type === 'move') setIndex(act.index);
      else if (act.type === 'pick' && act.index < suggestions.length) setPick(act.index);
      else if (act.type === 'confirm' && canConfirm && !confirm.isPending) confirm.mutate();
      else if (act.type === 'undo' && current?.matches.length && !undo.isPending) undo.mutate();
      else if (act.type === 'ignore' && current && !current.matches.length && !ignore.isPending) ignore.mutate();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, rows.length, suggestions.length, canConfirm, current, confirm, undo, ignore]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={t('banking.filter', { defaultValue: 'Filter' })} className={clsx(inputCls, 'w-auto')} value={filter} onChange={(e) => { setFilter(e.target.value); setIndex(0); }}>
          <option value={OPEN_FILTER}>{t('banking.filter_open', { defaultValue: 'Open lines' })}</option>
          <option value="matched">{t('banking.status_matched', { defaultValue: 'Matched' })}</option>
          <option value="ignored">{t('banking.status_ignored', { defaultValue: 'Ignored' })}</option>
          <option value="">{t('banking.filter_all', { defaultValue: 'All lines' })}</option>
        </select>
        {accounts.length > 1 && (
          <select aria-label={t('banking.tab_accounts', { defaultValue: 'Accounts' })} className={clsx(inputCls, 'w-auto')} value={accountId} onChange={(e) => { onAccount(e.target.value); setIndex(0); }}>
            <option value="">{t('banking.all_accounts', { defaultValue: 'All accounts' })}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <div className="relative min-w-[12rem] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-content-tertiary" />
          <input className={clsx(inputCls, 'pl-8')} placeholder={t('banking.search_lines', { defaultValue: 'Search counterparty, text, amount' })} value={search} onChange={(e) => { setSearch(e.target.value); setIndex(0); }} />
        </div>
        <Button size="sm" variant="secondary" icon={<Wand2 size={14} />} loading={applyRules.isPending} onClick={() => applyRules.mutate()}>
          {t('banking.apply_rules', { defaultValue: 'Apply rules' })}
        </Button>
        <Button size="sm" icon={<CheckCheck size={14} />} onClick={onBulk}>
          {t('banking.bulk_accept', { defaultValue: 'Accept confident' })}
        </Button>
        <Button size="sm" variant="ghost" icon={<Settings2 size={14} />} onClick={onSettings} aria-label={t('banking.settings_title', { defaultValue: 'Matching settings' })} />
      </div>
      <p className="flex items-center gap-1.5 text-xs text-content-tertiary">
        <Keyboard size={13} />
        {t('banking.keys_hint', { defaultValue: 'J/K move · 1–5 choose · Enter accept · U undo · X ignore' })}
        <span className="ml-auto tabular-nums">{t('banking.lines_count', { defaultValue: '{{n}} lines', n: rows.length })}</span>
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card padding="none" className="max-h-[72vh] overflow-y-auto">
          <BankLineList rows={rows} loading={lines.isLoading} currentId={current?.id} onSelect={setIndex} onImport={onImport} />
        </Card>
        <Card padding="sm" className="max-h-[72vh] overflow-y-auto">
          {current ? (
            <MatchPanel
              key={current.id}
              line={current}
              suggestions={suggestions}
              suggestionsLoading={sugg.isLoading && isOpen}
              pick={pick}
              onPick={setPick}
              items={items.data ?? []}
              drafts={drafts}
              onDrafts={setDrafts}
              writeOff={writeOff}
              onWriteOff={setWriteOff}
              writeOffMax={writeOffMax}
              rule={rule.data}
              busy={{ confirm: confirm.isPending, undo: undo.isPending, ignore: ignore.isPending, manual: manual.isPending }}
              error={error}
              onConfirm={() => confirm.mutate()}
              onUndo={() => undo.mutate()}
              onIgnore={() => ignore.mutate()}
              onManual={(code, memo, amount) => manual.mutate({ code, memo, amount })}
              onNewRule={() => onNewRule(ruleFromLine(current))}
            />
          ) : (
            <p className="p-6 text-center text-sm text-content-tertiary">
              {t('banking.select_line', { defaultValue: 'Select a line on the left to see its matches.' })}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
