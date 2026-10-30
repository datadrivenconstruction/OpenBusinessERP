import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { BookOpen, EyeOff, ListPlus, RotateCcw, Undo2, Wand2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Button, DateDisplay, MoneyDisplay } from '@/shared/ui';
import type { BankRule, BankTransaction, OpenItem, Suggestion } from '../api';
import { openAmount } from '../logic';
import type { DraftAlloc } from '../reconcile';
import { inputCls } from '../modals/AccountFormModal';
import { groupIban } from './AccountCards';
import { AllocationEditor } from './AllocationEditor';
import { STATUS_VARIANT } from './BankLineList';
import { SuggestionCard } from './SuggestionCard';
import { fmtNumberForInput } from '@/shared/lib/formatters';

export interface MatchPanelProps {
  line: BankTransaction;
  suggestions: Suggestion[];
  suggestionsLoading: boolean;
  pick: number;
  onPick: (i: number) => void;
  items: OpenItem[];
  drafts: DraftAlloc[];
  onDrafts: (d: DraftAlloc[]) => void;
  writeOff: boolean;
  onWriteOff: (v: boolean) => void;
  writeOffMax: number;
  rule: BankRule | null | undefined;
  busy: { confirm: boolean; undo: boolean; ignore: boolean; manual: boolean };
  error: string | null;
  onConfirm: () => void;
  onUndo: () => void;
  onIgnore: () => void;
  onManual: (code: string, memo: string, amount: string) => void;
  onNewRule: () => void;
}

/** Native disclosure; remounted per line (key) so its default reflects the line just selected. */
function Disclosure({ title, defaultOpen, children }: { title: ReactNode; defaultOpen: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-border-light">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-content-tertiary hover:text-content-primary">
        {title}
      </summary>
      <div className="border-t border-border-light p-3">{children}</div>
    </details>
  );
}

export function MatchPanel(p: MatchPanelProps) {
  const { t } = useTranslation();
  const { line } = p;
  const [code, setCode] = useState('');
  const [memo, setMemo] = useState('');
  const [amount, setAmount] = useState('');
  const open = openAmount(line);
  const isOpen = line.status === 'unmatched' || line.status === 'partially_matched';
  const ccy = line.currency;
  const typeLabel = (k: string) =>
    t(`banking.match_${k}`, { defaultValue: { sales_invoice: 'Invoice', purchase_bill: 'Bill', gl_entry: 'Account', write_off: 'Write-off' }[k] ?? k });

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-content-primary">{line.counterparty_name || '—'}</div>
            <div className="truncate font-mono text-xs text-content-tertiary">{line.counterparty_iban ? groupIban(line.counterparty_iban) : '—'}</div>
          </div>
          <div className="text-right">
            <MoneyDisplay amount={line.amount} currency={ccy} colorize className="text-lg font-semibold" />
            <div><Badge size="sm" variant={STATUS_VARIANT[line.status]}>{t(`banking.status_${line.status}`, { defaultValue: line.status.replace('_', ' ') })}</Badge></div>
          </div>
        </div>
        <p className="mt-2 whitespace-pre-line break-words text-sm text-content-secondary">{line.remittance || '—'}</p>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <div><dt className="text-content-tertiary">{t('banking.booking_date', { defaultValue: 'Booked' })}</dt><dd><DateDisplay value={line.booking_date} /></dd></div>
          <div><dt className="text-content-tertiary">{t('banking.value_date', { defaultValue: 'Value date' })}</dt><dd>{line.value_date ? <DateDisplay value={line.value_date} /> : '—'}</dd></div>
          <div><dt className="text-content-tertiary">{t('banking.open', { defaultValue: 'Open' })}</dt><dd className="font-medium"><MoneyDisplay amount={open} currency={ccy} /></dd></div>
        </dl>
      </div>

      {line.matches.length > 0 && (
        <div className="rounded-lg border border-border-light">
          <ul className="divide-y divide-border-light text-sm">
            {line.matches.map((m) => (
              <li key={m.id} className="flex items-center justify-between px-3 py-1.5">
                <span><span className="text-content-tertiary">{typeLabel(m.target_type)}</span> <span className="font-medium">{m.target_number}</span></span>
                <MoneyDisplay amount={m.amount} currency={ccy} />
              </li>
            ))}
          </ul>
          <div className="flex justify-end border-t border-border-light px-3 py-1.5">
            <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} loading={p.busy.undo} onClick={p.onUndo}>
              {t('banking.undo_match', { defaultValue: 'Undo match' })} <kbd className="ml-1 text-[10px] text-content-tertiary">U</kbd>
            </Button>
          </div>
        </div>
      )}

      {isOpen && p.rule && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-oe-blue/30 bg-oe-blue/5 px-3 py-2 text-sm">
          <span className="flex items-center gap-1.5">
            <Wand2 size={14} className="text-oe-blue" />
            {t('banking.rule_hint', { defaultValue: 'Rule “{{name}}” books this to {{code}}', name: p.rule.name, code: p.rule.account_code })}
          </span>
          <Button size="sm" variant="secondary" loading={p.busy.manual} onClick={() => p.onManual(p.rule!.account_code, p.rule!.memo || p.rule!.name, '')}>
            {t('banking.apply_rule', { defaultValue: 'Apply rule' })}
          </Button>
        </div>
      )}

      {isOpen && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-tertiary">
            {t('banking.suggestions', { defaultValue: 'Suggested matches' })}
          </h3>
          {p.suggestionsLoading ? (
            <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-secondary" />)}</div>
          ) : p.suggestions.length === 0 ? (
            <p className="text-sm text-content-secondary">
              {t('banking.no_suggestions', { defaultValue: 'No likely match. Allocate by hand, book it to an account or ignore it.' })}
            </p>
          ) : (
            <ol className="space-y-2">
              {p.suggestions.map((s, i) => (
                <li key={s.allocations.map((a) => a.id).join('+')}>
                  <SuggestionCard index={i} suggestion={s} currency={ccy} selected={i === p.pick} onSelect={() => p.onPick(i)} />
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {isOpen && (
        <Disclosure
          title={t('banking.allocation', { defaultValue: 'Allocation (split or partial)' })}
          defaultOpen={p.suggestions.length === 0 || p.drafts.length > 1}
        >
          <AllocationEditor
            line={line}
            lineOpen={open}
            items={p.items}
            drafts={p.drafts}
            onChange={p.onDrafts}
            writeOffMax={p.writeOffMax}
            writeOff={p.writeOff}
            onWriteOff={p.onWriteOff}
            busy={p.busy.confirm}
            onConfirm={p.onConfirm}
          />
        </Disclosure>
      )}

      {isOpen && (
        <Disclosure title={t('banking.manual_entry', { defaultValue: 'Book to account' })} defaultOpen={false}>
          <form
            className="grid gap-2 sm:grid-cols-[7rem_1fr_7rem_auto]"
            onSubmit={(e) => { e.preventDefault(); p.onManual(code, memo, amount); }}
          >
            <input className={inputCls} required placeholder={t('banking.account_code', { defaultValue: 'Account' })} value={code} onChange={(e) => setCode(e.target.value)} />
            <input className={inputCls} placeholder={t('banking.rule_memo', { defaultValue: 'Booking text' })} value={memo} onChange={(e) => setMemo(e.target.value)} />
            <input className={inputCls} inputMode="decimal" placeholder={fmtNumberForInput(open)} value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} />
            <Button size="sm" variant="secondary" type="submit" icon={<BookOpen size={13} />} disabled={!code} loading={p.busy.manual}>
              {t('banking.book', { defaultValue: 'Book' })}
            </Button>
          </form>
        </Disclosure>
      )}

      <div className={clsx('flex flex-wrap items-center gap-2 border-t border-border-light pt-3')}>
        {line.status !== 'matched' && line.status !== 'partially_matched' && (
          <Button size="sm" variant="ghost" icon={line.status === 'ignored' ? <RotateCcw size={13} /> : <EyeOff size={13} />} loading={p.busy.ignore} onClick={p.onIgnore}>
            {line.status === 'ignored' ? t('banking.unignore', { defaultValue: 'Restore' }) : t('banking.ignore', { defaultValue: 'Ignore' })}
            <kbd className="ml-1 text-[10px] text-content-tertiary">X</kbd>
          </Button>
        )}
        {isOpen && (
          <Button size="sm" variant="ghost" icon={<ListPlus size={13} />} onClick={p.onNewRule}>
            {t('banking.rule_from_line', { defaultValue: 'Create rule from this line' })}
          </Button>
        )}
      </div>
      {p.error && <p role="alert" className="text-sm text-semantic-error">{p.error}</p>}
    </div>
  );
}
