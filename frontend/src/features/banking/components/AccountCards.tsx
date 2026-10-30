import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AlertTriangle, Landmark, Pencil, Upload } from 'lucide-react';
import { Badge, Button, Card, DateDisplay, EmptyState, MoneyDisplay } from '@/shared/ui';
import type { AccountSummary, BankAccount } from '../api';
import { ledgerGap } from './BankingKpis';

interface Props {
  accounts: BankAccount[];
  summary: AccountSummary[];
  onEdit: (a: BankAccount) => void;
  onImport: (accountId: string) => void;
  onReconcile: (accountId: string) => void;
  onAdd: () => void;
}

/** Formats an IBAN in groups of four for reading; the stored value stays compact. */
export function groupIban(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

export function AccountCards({ accounts, summary, onEdit, onImport, onReconcile, onAdd }: Props) {
  const { t } = useTranslation();
  if (accounts.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          icon={<Landmark size={22} />}
          title={t('banking.no_accounts', { defaultValue: 'No bank accounts yet' })}
          description={t('banking.no_accounts_desc', { defaultValue: 'Add your first account, then import a statement exported from online banking.' })}
          action={{ label: t('banking.add_account', { defaultValue: 'Add account' }), onClick: onAdd }}
        />
      </Card>
    );
  }
  const byId = new Map(summary.map((s) => [s.account_id, s]));
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {accounts.map((a) => {
        const s = byId.get(a.id);
        const open = s?.unmatched_count ?? 0;
        const gap = ledgerGap(s);
        return (
          <Card key={a.id} padding="sm" className={clsx('flex flex-col gap-3', !a.active && 'opacity-60')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Landmark size={15} className="shrink-0 text-oe-blue" />
                  <span className="truncate font-semibold text-content-primary">{a.name}</span>
                  {!a.active && <Badge size="sm">{t('banking.inactive', { defaultValue: 'Inactive' })}</Badge>}
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-content-tertiary">{a.iban ? groupIban(a.iban) : '—'}</div>
              </div>
              <button
                type="button"
                onClick={() => onEdit(a)}
                aria-label={t('banking.edit_account', { defaultValue: 'Edit account' })}
                className="rounded p-1 text-content-tertiary hover:bg-surface-secondary hover:text-content-primary"
              >
                <Pencil size={14} />
              </button>
            </div>
            <div>
              <div className="text-xs text-content-tertiary">{t('banking.kpi_balance', { defaultValue: 'Bank balance' })}</div>
              <MoneyDisplay amount={s?.balance ?? 0} currency={a.currency} className="text-xl font-semibold" colorize />
              <div className="mt-0.5 text-xs text-content-tertiary">
                {t('banking.kpi_balance_sub', { defaultValue: 'Opening balance + statement lines' })}
              </div>
              {gap !== null && (
                <button
                  type="button"
                  onClick={() => onReconcile(a.id)}
                  title={t('banking.gl_gap_hint', { defaultValue: 'Ledger balance: {{amount}}. Reconcile open lines or check the opening balance.', amount: s?.gl_balance ?? '0' })}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300"
                >
                  <AlertTriangle size={11} />
                  {t('banking.gl_gap', { defaultValue: 'Differs from ledger by' })}{' '}
                  <MoneyDisplay amount={gap} currency={a.currency} />
                </button>
              )}
            </div>
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-content-tertiary">{t('banking.card_lines', { defaultValue: 'Lines' })}</dt>
                <dd className="font-medium tabular-nums text-content-primary">{s?.line_count ?? 0}</dd>
              </div>
              <div>
                <dt className="text-content-tertiary">{t('banking.card_open', { defaultValue: 'To reconcile' })}</dt>
                <dd className={clsx('font-medium tabular-nums', open ? 'text-amber-600 dark:text-amber-400' : 'text-semantic-success')}>{open}</dd>
              </div>
              <div>
                <dt className="text-content-tertiary">{t('banking.card_last', { defaultValue: 'Last booking' })}</dt>
                <dd className="font-medium text-content-primary">
                  {s?.last_booking_date ? <DateDisplay value={s.last_booking_date} /> : '—'}
                </dd>
              </div>
            </dl>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border-light pt-2 text-xs text-content-tertiary">
              <span>
                {a.currency} · {t('banking.col_gl', { defaultValue: 'GL account' })} {a.gl_account_code || '—'}
              </span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" icon={<Upload size={13} />} onClick={() => onImport(a.id)}>
                  {t('banking.import_short', { defaultValue: 'Import' })}
                </Button>
                {open > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => onReconcile(a.id)}>
                    {t('banking.reconcile_short', { defaultValue: 'Reconcile' })}
                  </Button>
                )}
              </span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
