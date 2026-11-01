import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, Paperclip, Plus, Trash2 } from 'lucide-react';
import { fmtMoney } from '@/features/sales/api';
import { getErrorMessage } from '@/shared/lib/api';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { STATUS_VARIANT, entryBalance, glApi, iso, toCents, useBusinessCurrency, validateEntry, type Account, type LineDraft } from './api';
import { AccountingShell, ErrorBlock, Field, LoadingBlock, SourceChip, inputCls, numCls, thCls } from './ui';
import { formatFileSize } from '@/shared/lib/formatters';
import { DateField } from '@/shared/ui/DateField';

const emptyLine = (): LineDraft => ({ account_id: '', description: '', debit: '', credit: '' });

export function JournalEntryPage() {
  const { id } = useParams<{ id: string }>();
  return id && id !== 'new' ? <EntryDetail id={id} /> : <NewEntry />;
}

const accLabel = (a: Account) => `${a.code} ${a.name}`;

function NewEntry() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const currency = useBusinessCurrency();
  const accounts = useQuery({ queryKey: ['gl', 'accounts'], queryFn: glApi.accounts, retry: false });
  const postable = useMemo(
    () => (accounts.data ?? []).filter((a) => a.is_postable && a.active).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    [accounts.data],
  );
  const [date, setDate] = useState(iso(new Date()));
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [err, setErr] = useState<string | null>(null);

  const bal = entryBalance(lines);
  const problem = validateEntry(lines);
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines((ls) => (ls.length > 2 ? ls.filter((_, j) => j !== i) : ls));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);

  const save = useMutation({
    mutationFn: async (andPost: boolean) => {
      const entry = await glApi.createEntry({
        entry_date: date,
        memo,
        lines: lines
          .filter((l) => l.account_id)
          .map((l) => ({ account_id: l.account_id, description: l.description, debit: l.debit || '0', credit: l.credit || '0' })),
      });
      if (andPost) await glApi.post(entry.id).catch((e) => { throw Object.assign(new Error(getErrorMessage(e)), { entryId: entry.id }); });
      return entry;
    },
    onSuccess: (entry) => {
      qc.invalidateQueries({ queryKey: ['gl'] });
      navigate(`/accounting/journal/${entry.id}`);
    },
    onError: (e: Error & { entryId?: string }) => {
      qc.invalidateQueries({ queryKey: ['gl'] });
      // The draft exists even though posting failed: open it so nothing is lost.
      if (e.entryId) navigate(`/accounting/journal/${e.entryId}`);
      else setErr(getErrorMessage(e));
    },
  });

  const hint =
    problem === 'lines'
      ? t('accounting.v_lines', { defaultValue: 'Add at least two lines.' })
      : problem === 'line'
        ? t('accounting.v_line', { defaultValue: 'Each line needs an account and either a debit or a credit.' })
        : problem === 'balance'
          ? t('accounting.v_balance', { defaultValue: 'Debits and credits must be equal.' })
          : null;

  return (
    <AccountingShell
      parent={{ label: t('accounting.tab_journal', { defaultValue: 'Journal' }), to: '/accounting/journal' }}
      title={t('accounting.new_entry', { defaultValue: 'New entry' })}
    >
      {accounts.isLoading ? (
        <LoadingBlock />
      ) : accounts.error ? (
        <ErrorBlock error={accounts.error} onRetry={() => accounts.refetch()} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!problem) save.mutate(false);
          }}
          className="space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <Field label={t('accounting.col_date', { defaultValue: 'Date' })}>
              <DateField required className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} autoFocus />
            </Field>
            <Field label={t('accounting.col_memo', { defaultValue: 'Memo' })}>
              <input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} />
            </Field>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border-light bg-surface-elevated shadow-xs">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-content-tertiary">
                <tr>
                  <th className={thCls}>{t('accounting.col_name', { defaultValue: 'Account' })}</th>
                  <th className={thCls}>{t('accounting.col_description', { defaultValue: 'Description' })}</th>
                  <th className={thCls + ' w-32 text-right'}>{t('accounting.col_debit', { defaultValue: 'Debit' })}</th>
                  <th className={thCls + ' w-32 text-right'}>{t('accounting.col_credit', { defaultValue: 'Credit' })}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-border-light">
                    <td className="px-2 py-1">
                      <select aria-label={t('accounting.col_name', { defaultValue: 'Account' })} className={inputCls} value={l.account_id} onChange={(e) => setLine(i, { account_id: e.target.value })}>
                        <option value="">{t('accounting.select_account', { defaultValue: 'Select account…' })}</option>
                        {postable.map((a) => (
                          <option key={a.id} value={a.id}>{accLabel(a)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input aria-label={t('accounting.col_description', { defaultValue: 'Description' })} className={inputCls} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        aria-label={t('accounting.col_debit', { defaultValue: 'Debit' })}
                        inputMode="decimal"
                        className={inputCls + ' text-right tabular-nums'}
                        value={l.debit}
                        onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        aria-label={t('accounting.col_credit', { defaultValue: 'Credit' })}
                        inputMode="decimal"
                        className={inputCls + ' text-right tabular-nums'}
                        value={l.credit}
                        onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && i === lines.length - 1) {
                            e.preventDefault();
                            addLine();
                          }
                        }}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        disabled={lines.length <= 2}
                        onClick={() => removeLine(i)}
                        aria-label={t('accounting.remove_line', { defaultValue: 'Remove line' })}
                        className="rounded p-1 text-content-tertiary hover:text-content-primary disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border-light bg-surface-secondary text-sm">
                <tr>
                  <td colSpan={2} className="px-4 py-2.5">
                    <Button type="button" size="sm" variant="ghost" onClick={addLine}>
                      <Plus className="mr-1 h-4 w-4" />
                      {t('accounting.add_line', { defaultValue: 'Add line' })}
                    </Button>
                  </td>
                  <td className={numCls + ' font-medium'}>{fmtMoney(bal.debit, currency)}</td>
                  <td className={numCls + ' font-medium'}>{fmtMoney(bal.credit, currency)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div aria-live="polite" className="text-sm">
            {bal.diff !== 0 ? (
              <span className="text-semantic-error">
                {t('accounting.difference', { defaultValue: 'Difference' })}: {fmtMoney(Math.abs(bal.diff), currency)}
              </span>
            ) : bal.balanced ? (
              <span className="text-content-secondary">{t('accounting.balanced', { defaultValue: 'Balanced' })}</span>
            ) : null}
            {hint && bal.diff === 0 && <span className="text-content-tertiary"> {hint}</span>}
          </div>
          {err && <p role="alert" className="text-sm text-semantic-error">{err}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" size="sm" disabled={!!problem || save.isPending}>
              {t('accounting.save_draft', { defaultValue: 'Save draft' })}
            </Button>
            <Button type="button" size="sm" disabled={!!problem || save.isPending} onClick={() => save.mutate(true)}>
              {t('accounting.save_post', { defaultValue: 'Save and post' })}
            </Button>
          </div>
        </form>
      )}
    </AccountingShell>
  );
}

function EntryDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const entry = useQuery({ queryKey: ['gl', 'entry', id], queryFn: () => glApi.entry(id), retry: false });
  const accounts = useQuery({ queryKey: ['gl', 'accounts'], queryFn: glApi.accounts, retry: false });
  const byId = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);
  const [revDate, setRevDate] = useState(iso(new Date()));
  const [reversing, setReversing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const done = (e?: { id: string }) => {
    qc.invalidateQueries({ queryKey: ['gl'] });
    setErr(null);
    setReversing(false);
    if (e && e.id !== id) navigate(`/accounting/journal/${e.id}`);
  };
  const fail = (e: unknown) => setErr(getErrorMessage(e));
  const post = useMutation({ mutationFn: () => glApi.post(id), onSuccess: () => done(), onError: fail });
  const reverse = useMutation({ mutationFn: () => glApi.reverse(id, revDate), onSuccess: done, onError: fail });
  const remove = useMutation({
    mutationFn: () => glApi.deleteEntry(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gl'] }); navigate('/accounting/journal'); },
    onError: (e) => { setConfirmDelete(false); fail(e); },
  });

  const e = entry.data;
  const bal = e ? entryBalance(e.lines) : null;
  return (
    <AccountingShell
      parent={{ label: t('accounting.tab_journal', { defaultValue: 'Journal' }), to: '/accounting/journal' }}
      title={e ? (e.number ?? t('accounting.draft_entry', { defaultValue: 'Draft entry' })) : t('accounting.entry', { defaultValue: 'Journal entry' })}
    >
      {entry.isLoading ? (
        <LoadingBlock />
      ) : entry.error || !e ? (
        <ErrorBlock error={entry.error} onRetry={() => entry.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Badge size="sm" variant={STATUS_VARIANT[e.status] ?? 'neutral'}>{t(`accounting.status_${e.status}`, { defaultValue: e.status })}</Badge>
            <span className="text-content-secondary">{e.entry_date}</span>
            <span className="text-content-secondary"><SourceChip source={e.source_type} /></span>
            {e.reversal_of_id && (
              <Link className="text-content-primary hover:underline" to={`/accounting/journal/${e.reversal_of_id}`}>
                {t('accounting.reversal_of', { defaultValue: 'Reverses an earlier entry' })}
              </Link>
            )}
            {e.reversed_by_id && (
              <Link className="text-content-primary hover:underline" to={`/accounting/journal/${e.reversed_by_id}`}>
                {t('accounting.reversed_by', { defaultValue: 'View reversal' })}
              </Link>
            )}
          </div>
          {e.memo && <p className="text-sm text-content-primary">{e.memo}</p>}
          <div className="overflow-x-auto rounded-xl border border-border-light bg-surface-elevated shadow-xs">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-content-tertiary">
                <tr>
                  <th className={thCls}>{t('accounting.col_name', { defaultValue: 'Account' })}</th>
                  <th className={thCls}>{t('accounting.col_description', { defaultValue: 'Description' })}</th>
                  <th className={thCls + ' text-right'}>{t('accounting.col_debit', { defaultValue: 'Debit' })}</th>
                  <th className={thCls + ' text-right'}>{t('accounting.col_credit', { defaultValue: 'Credit' })}</th>
                </tr>
              </thead>
              <tbody>
                {e.lines.map((l) => {
                  const a = byId.get(l.account_id);
                  return (
                    <tr key={l.id ?? l.line_no} className="border-t border-border-light">
                      <td className="px-4 py-2">
                        <Link to={`/accounting/ledger/${l.account_id}`} className="text-content-primary hover:underline">
                          {a ? accLabel(a) : l.account_id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-content-secondary">{l.description || '—'}</td>
                      <td className={numCls}>{toCents(l.debit) ? fmtMoney(l.debit, e.currency) : ''}</td>
                      <td className={numCls}>{toCents(l.credit) ? fmtMoney(l.credit, e.currency) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
              {bal && (
                <tfoot className="border-t border-border-light bg-surface-secondary font-medium">
                  <tr>
                    <td colSpan={2} className="px-4 py-2 text-content-secondary">{t('accounting.total', { defaultValue: 'Total' })}</td>
                    <td className={numCls}>{fmtMoney(bal.debit, e.currency)}</td>
                    <td className={numCls}>{fmtMoney(bal.credit, e.currency)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <EntryAttachments entryId={e.id} />
          {err && <p role="alert" className="text-sm text-semantic-error">{err}</p>}
          <div className="flex flex-wrap items-end gap-2">
            {e.status === 'draft' && (
              <>
                <Button size="sm" loading={post.isPending} onClick={() => post.mutate()}>{t('accounting.post', { defaultValue: 'Post entry' })}</Button>
                <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>{t('common.delete', { defaultValue: 'Delete' })}</Button>
              </>
            )}
            {e.status === 'posted' && !reversing && (
              <Button size="sm" variant="secondary" onClick={() => setReversing(true)}>{t('accounting.reverse', { defaultValue: 'Reverse entry' })}</Button>
            )}
            {e.status === 'posted' && reversing && (
              <form
                className="flex items-end gap-2"
                onSubmit={(ev) => { ev.preventDefault(); reverse.mutate(); }}
                onKeyDown={(ev) => ev.key === 'Escape' && setReversing(false)}
              >
                <Field label={t('accounting.reversal_date', { defaultValue: 'Reversal date' })}>
                  <DateField required autoFocus className={inputCls} value={revDate} onChange={(ev) => setRevDate(ev.target.value)} />
                </Field>
                <Button type="submit" size="sm" loading={reverse.isPending}>{t('accounting.reverse_confirm', { defaultValue: 'Create reversal' })}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setReversing(false)}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
              </form>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={t('accounting.delete_title', { defaultValue: 'Delete this draft?' })}
        message={t('accounting.delete_msg', { defaultValue: 'The draft entry will be removed. This cannot be undone.' })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </AccountingShell>
  );
}

function EntryAttachments({ entryId }: { entryId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['gl', 'attachments', entryId];
  const list = useQuery({ queryKey: key, queryFn: () => glApi.attachments(entryId), retry: false });
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => { setErr(null); qc.invalidateQueries({ queryKey: key }); };
  const upload = useMutation({ mutationFn: (f: File) => glApi.uploadAttachment(entryId, f), onSuccess: refresh, onError: (e) => setErr(getErrorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => glApi.deleteAttachment(id), onSuccess: refresh, onError: (e) => setErr(getErrorMessage(e)) });
  const kb = (n: number) => formatFileSize(n);
  return (
    <section className="rounded-xl border border-border-light bg-surface-elevated p-4 shadow-xs">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium text-content-primary">
          <Paperclip size={14} aria-hidden />
          {t('accounting.attachments', { defaultValue: 'Attachments' })}
        </h3>
        <label className="cursor-pointer rounded px-3 py-1.5 text-sm text-content-primary hover:bg-surface-secondary">
          {upload.isPending ? '…' : t('accounting.attach_file', { defaultValue: 'Attach file' })}
          <input
            type="file"
            className="sr-only"
            onChange={(ev) => { const f = ev.target.files?.[0]; if (f) upload.mutate(f); ev.target.value = ''; }}
          />
        </label>
      </div>
      {list.data && list.data.length === 0 && (
        <p className="text-sm text-content-tertiary">
          {t('accounting.attachments_empty', { defaultValue: 'No documents yet. Attach the receipt, invoice or contract behind this entry (up to 10 MB).' })}
        </p>
      )}
      <ul className="divide-y divide-border-light">
        {(list.data ?? []).map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <button type="button" className="flex items-center gap-2 text-content-primary hover:underline" onClick={() => glApi.downloadAttachment(a).catch((e) => setErr(getErrorMessage(e)))}>
              <Download size={14} aria-hidden />
              {a.filename}
            </button>
            <span className="flex items-center gap-3 text-content-tertiary">
              {kb(a.size)}
              <button type="button" aria-label={t('common.delete', { defaultValue: 'Delete' })} className="hover:text-semantic-error" onClick={() => remove.mutate(a.id)}>
                <Trash2 size={14} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {err && <p role="alert" className="mt-2 text-sm text-semantic-error">{err}</p>}
    </section>
  );
}
