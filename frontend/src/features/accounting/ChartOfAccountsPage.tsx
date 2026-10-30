import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Search } from 'lucide-react';
import { fmtMoney } from '@/features/sales/api';
import { getErrorMessage } from '@/shared/lib/api';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { ACCOUNT_TYPES, glApi, natural, useBusinessCurrency, type Account, type AccountInput, type AccountType } from './api';
import { AccountingShell, EmptyBlock, ErrorBlock, Field, LoadingBlock, inputCls, numCls, thCls } from './ui';

const TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
};

interface Node {
  acc: Account;
  children: Node[];
  balance: number;
}

function buildTree(accounts: Account[], bal: Map<string, number>): Record<AccountType, Node[]> {
  const nodes = new Map<string, Node>(accounts.map((a) => [a.id, { acc: a, children: [], balance: bal.get(a.id) ?? 0 }]));
  const roots: Record<AccountType, Node[]> = { asset: [], liability: [], equity: [], income: [], expense: [] };
  for (const n of nodes.values()) {
    const parent = n.acc.parent_id ? nodes.get(n.acc.parent_id) : undefined;
    // A parent of another type would be a data error; show the row at the top of its own class.
    if (parent && parent.acc.account_type === n.acc.account_type) parent.children.push(n);
    else roots[n.acc.account_type]?.push(n);
  }
  const sort = (list: Node[]) => {
    list.sort((a, b) => a.acc.code.localeCompare(b.acc.code, undefined, { numeric: true }));
    list.forEach((n) => sort(n.children));
  };
  const roll = (n: Node): number => {
    n.balance += n.children.reduce((s, c) => s + roll(c), 0);
    return n.balance;
  };
  for (const t of ACCOUNT_TYPES) {
    sort(roots[t]);
    roots[t].forEach(roll);
  }
  return roots;
}

function filterTree(list: Node[], q: string): Node[] {
  if (!q) return list;
  return list.flatMap((n) => {
    const kids = filterTree(n.children, q);
    const hit = `${n.acc.code} ${n.acc.name}`.toLowerCase().includes(q);
    return hit || kids.length ? [{ ...n, children: hit ? n.children : kids }] : [];
  });
}

export function ChartOfAccountsPage() {
  const { t } = useTranslation();
  const currency = useBusinessCurrency();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const accounts = useQuery({ queryKey: ['gl', 'accounts'], queryFn: glApi.accounts, retry: false });
  const tb = useQuery({ queryKey: ['gl', 'tb', 'all'], queryFn: () => glApi.trialBalance(), retry: false });

  const roots = useMemo(() => {
    const bal = new Map((tb.data?.rows ?? []).map((r) => [r.account_id, natural(r.account_type, r.closing)]));
    return buildTree(accounts.data ?? [], bal);
  }, [accounts.data, tb.data]);
  const q = search.trim().toLowerCase();

  const renderNode = (n: Node, depth: number): React.ReactNode => (
    <Fragment key={n.acc.id}>
      <tr className="border-t border-border-light hover:bg-surface-secondary">
        <td className="px-4 py-2 font-mono text-xs text-content-secondary">{n.acc.code}</td>
        <td className="py-2 pr-4 text-content-primary" style={{ paddingLeft: 16 + depth * 18 }}>
          <Link to={`/accounting/ledger/${n.acc.id}`} className={n.children.length ? 'font-medium hover:underline' : 'hover:underline'}>
            {n.acc.name}
          </Link>
          {!n.acc.active && <Badge size="sm" variant="neutral" className="ml-2">{t('accounting.inactive', { defaultValue: 'Inactive' })}</Badge>}
          {!n.acc.is_postable && <Badge size="sm" variant="blue" className="ml-2">{t('accounting.header_account', { defaultValue: 'Header' })}</Badge>}
        </td>
        <td className={numCls}>{n.balance ? fmtMoney(n.balance, currency) : '—'}</td>
        <td className="px-4 py-2 text-right">
          <button
            type="button"
            onClick={() => setEditing(n.acc)}
            aria-label={t('accounting.edit_account', { defaultValue: 'Edit account' }) + ` ${n.acc.code}`}
            className="rounded p-1 text-content-tertiary hover:bg-surface-secondary hover:text-content-primary"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>
      {n.children.map((c) => renderNode(c, depth + 1))}
    </Fragment>
  );

  const total = accounts.data?.length ?? 0;
  const visible = ACCOUNT_TYPES.map((ty) => ({ ty, list: filterTree(roots[ty], q) })).filter((g) => g.list.length);

  return (
    <AccountingShell
      title={t('accounting.tab_accounts', { defaultValue: 'Chart of accounts' })}
      actions={
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setEditing('new')}>
          {t('accounting.new_account', { defaultValue: 'New account' })}
        </Button>
      }
    >
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-content-tertiary" aria-hidden />
        <input
          type="search"
          className={inputCls + ' pl-8'}
          placeholder={t('accounting.search_accounts', { defaultValue: 'Search by code or name' })}
          aria-label={t('accounting.search_accounts', { defaultValue: 'Search by code or name' })}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {accounts.isLoading ? (
        <LoadingBlock />
      ) : accounts.error ? (
        <ErrorBlock error={accounts.error} onRetry={() => accounts.refetch()} />
      ) : total === 0 ? (
        <EmptyBlock
          title={t('accounting.accounts_empty', { defaultValue: 'No accounts yet' })}
          hint={t('accounting.accounts_empty_hint', { defaultValue: 'Add your first account to start recording entries.' })}
          action={<Button size="sm" onClick={() => setEditing('new')}>{t('accounting.new_account', { defaultValue: 'New account' })}</Button>}
        />
      ) : visible.length === 0 ? (
        <EmptyBlock title={t('accounting.no_match', { defaultValue: 'No accounts match your search' })} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-light bg-surface-elevated shadow-xs">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-content-tertiary">
              <tr>
                <th className={thCls + ' w-28'}>{t('accounting.col_code', { defaultValue: 'Code' })}</th>
                <th className={thCls}>{t('accounting.col_name', { defaultValue: 'Account' })}</th>
                <th className={thCls + ' text-right'}>{t('accounting.col_balance', { defaultValue: 'Balance' })}</th>
                <th className="w-10" />
              </tr>
            </thead>
            {visible.map(({ ty, list }) => (
              <tbody key={ty}>
                <tr className="border-t border-border-light bg-surface-secondary/60">
                  <th colSpan={4} scope="colgroup" className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-content-secondary">
                    {t(`accounting.type_${ty}`, { defaultValue: TYPE_LABEL[ty] })}
                  </th>
                </tr>
                {list.map((n) => renderNode(n, 0))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {editing && <AccountDialog account={editing === 'new' ? null : editing} accounts={accounts.data ?? []} onClose={() => setEditing(null)} />}
    </AccountingShell>
  );
}

function AccountDialog({ account, accounts, onClose }: { account: Account | null; accounts: Account[]; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState<AccountInput>({
    code: account?.code ?? '',
    name: account?.name ?? '',
    account_type: account?.account_type ?? 'asset',
    parent_id: account?.parent_id ?? null,
    is_postable: account?.is_postable ?? true,
    active: account?.active ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: () => {
      if (account) {
        const { code: _code, ...rest } = f;
        return glApi.updateAccount(account.id, rest);
      }
      return glApi.createAccount({ ...f, code: (f.code ?? '').trim(), name: f.name.trim() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl'] });
      onClose();
    },
    onError: (e) => setErr(getErrorMessage(e)),
  });
  const parents = accounts.filter((a) => a.id !== account?.id && a.account_type === f.account_type);
  const valid = (f.code ?? '').trim() !== '' && f.name.trim() !== '';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) save.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={account ? t('accounting.edit_account', { defaultValue: 'Edit account' }) : t('accounting.new_account', { defaultValue: 'New account' })}
        onSubmit={submit}
        className="w-full max-w-md space-y-3 rounded-lg border border-border-light bg-surface-primary p-5 shadow-lg"
      >
        <h2 className="text-base font-semibold text-content-primary">
          {account ? t('accounting.edit_account', { defaultValue: 'Edit account' }) : t('accounting.new_account', { defaultValue: 'New account' })}
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('accounting.col_code', { defaultValue: 'Code' })}>
            <input className={inputCls} autoFocus={!account} disabled={!!account} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={32} />
          </Field>
          <Field label={t('accounting.col_name', { defaultValue: 'Account' })} className="col-span-2">
            <input className={inputCls} autoFocus={!!account} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={255} />
          </Field>
        </div>
        <Field label={t('accounting.col_type', { defaultValue: 'Type' })}>
          <select className={inputCls} value={f.account_type} onChange={(e) => setF({ ...f, account_type: e.target.value as AccountType, parent_id: null })}>
            {ACCOUNT_TYPES.map((ty) => (
              <option key={ty} value={ty}>{t(`accounting.type_${ty}`, { defaultValue: TYPE_LABEL[ty] })}</option>
            ))}
          </select>
        </Field>
        <Field label={t('accounting.parent', { defaultValue: 'Parent account' })}>
          <select className={inputCls} value={f.parent_id ?? ''} onChange={(e) => setF({ ...f, parent_id: e.target.value || null })}>
            <option value="">{t('accounting.no_parent', { defaultValue: 'None (top level)' })}</option>
            {parents.map((a) => (
              <option key={a.id} value={a.id}>{a.code} {a.name}</option>
            ))}
          </select>
        </Field>
        <div className="flex gap-5 text-sm text-content-primary">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.is_postable} onChange={(e) => setF({ ...f, is_postable: e.target.checked })} />
            {t('accounting.postable', { defaultValue: 'Accepts postings' })}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            {t('accounting.active', { defaultValue: 'Active' })}
          </label>
        </div>
        {err && <p role="alert" className="text-sm text-semantic-error">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button type="submit" size="sm" disabled={!valid || save.isPending}>{t('common.save', { defaultValue: 'Save' })}</Button>
        </div>
      </form>
    </div>
  );
}
