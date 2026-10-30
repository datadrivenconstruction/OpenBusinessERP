import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListFilter, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, MoneyDisplay, SkeletonTable } from '@/shared/ui';
import { Toggle } from '@/shared/ui/Toggle';
import { getErrorMessage } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { bankingApi, type ApplyRulesResult, type BankRule } from '../api';

interface Props {
  onNew: () => void;
  onEdit: (r: BankRule) => void;
  currency: string;
}

export function RulesPanel({ onNew, onEdit, currency }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const rules = useQuery({ queryKey: ['banking', 'rules'], queryFn: bankingApi.rules });
  const [preview, setPreview] = useState<ApplyRulesResult | null>(null);
  const [toDelete, setToDelete] = useState<BankRule | null>(null);
  const onError = (e: unknown) => addToast({ type: 'error', title: getErrorMessage(e) });
  const toggle = useMutation({
    mutationFn: (r: BankRule) => bankingApi.updateRule(r.id, { active: !r.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['banking'] }),
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => bankingApi.deleteRule(id),
    onSuccess: () => { setToDelete(null); qc.invalidateQueries({ queryKey: ['banking'] }); },
    onError,
  });
  const dry = useMutation({ mutationFn: () => bankingApi.applyRules(true), onSuccess: setPreview, onError });
  const apply = useMutation({
    mutationFn: () => bankingApi.applyRules(false),
    onSuccess: (r) => {
      setPreview(null);
      qc.invalidateQueries({ queryKey: ['banking'] });
      addToast({ type: 'success', title: t('banking.rules_applied', { defaultValue: '{{n}} lines booked by rules', n: r.applied }) });
      if (r.errors.length) addToast({ type: 'warning', title: r.errors[0] ?? "" });
    },
    onError,
  });
  const fieldLabel = (f: string) =>
    t(`banking.rule_field_${f}`, { defaultValue: { counterparty: 'Counterparty name', text: 'Payment text and reference', iban: 'Counterparty IBAN', any: 'Anywhere' }[f] ?? f });
  const dirLabel = (d: string) =>
    t(`banking.dir_${d}`, { defaultValue: { in: 'Money in', out: 'Money out', any: 'Money in or out' }[d] ?? d });
  const list = rules.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-content-secondary">
          {t('banking.rules_intro', {
            defaultValue: 'Rules book recurring lines without a document, such as bank fees, rent or card settlements, straight to an account. Lower priority numbers run first.',
          })}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon={<Wand2 size={14} />} disabled={!list.length} loading={dry.isPending} onClick={() => dry.mutate()}>
            {t('banking.rules_preview', { defaultValue: 'Preview on open lines' })}
          </Button>
          <Button size="sm" icon={<Plus size={14} />} onClick={onNew}>{t('banking.new_rule', { defaultValue: 'New rule' })}</Button>
        </div>
      </div>

      {preview && (
        <Card padding="sm" className="border-oe-blue/30 bg-oe-blue/5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {t('banking.rules_preview_result', { defaultValue: '{{n}} open lines would be booked.', n: preview.hits.length })}
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
              <Button size="sm" disabled={!preview.hits.length} loading={apply.isPending} onClick={() => apply.mutate()}>
                {t('banking.rules_apply_now', { defaultValue: 'Book them now' })}
              </Button>
            </span>
          </div>
          {preview.hits.length > 0 && (
            <ul className="mt-2 max-h-40 divide-y divide-border-light overflow-y-auto text-xs">
              {preview.hits.map((h) => (
                <li key={h.transaction_id} className="flex justify-between py-1">
                  <span>{h.rule_name} → {h.account_code}</span>
                  <MoneyDisplay amount={h.amount} currency={currency} colorize />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card padding="none">
        {rules.isLoading ? (
          <div className="p-4"><SkeletonTable rows={4} columns={5} /></div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<ListFilter size={22} />}
            title={t('banking.no_rules', { defaultValue: 'No rules yet' })}
            description={t('banking.no_rules_desc', { defaultValue: 'Create one here or from any open line in the reconciliation.' })}
            action={{ label: t('banking.new_rule', { defaultValue: 'New rule' }), onClick: onNew }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary text-xs uppercase tracking-wide text-content-tertiary">
                <tr>
                  <th className="px-4 py-2.5 text-left">{t('banking.rule_name', { defaultValue: 'Rule name' })}</th>
                  <th className="px-4 py-2.5 text-left">{t('banking.rule_condition', { defaultValue: 'Condition' })}</th>
                  <th className="px-4 py-2.5 text-left">{t('banking.account_code', { defaultValue: 'Account' })}</th>
                  <th className="px-4 py-2.5 text-right">{t('banking.rule_priority', { defaultValue: 'Priority' })}</th>
                  <th className="px-4 py-2.5 text-right">{t('banking.rule_hits', { defaultValue: 'Booked' })}</th>
                  <th className="px-4 py-2.5 text-center">{t('banking.active', { defaultValue: 'Active' })}</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-t border-border-light hover:bg-surface-secondary">
                    <td className="px-4 py-2 font-medium text-content-primary">{r.name}</td>
                    <td className="px-4 py-2 text-content-secondary">
                      <span className="text-content-tertiary">{fieldLabel(r.match_field)}:</span> <code className="rounded bg-surface-secondary px-1">{r.pattern}</code>
                      <span className="ml-1.5"><Badge size="sm">{dirLabel(r.direction)}</Badge></span>
                      {(r.min_amount || r.max_amount) && (
                        <span className="ml-1.5 text-xs text-content-tertiary">
                          {r.min_amount ? <MoneyDisplay amount={r.min_amount} currency={currency} /> : '0'} – {r.max_amount ? <MoneyDisplay amount={r.max_amount} currency={currency} /> : '∞'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-content-secondary">{r.account_code}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-content-secondary">{r.priority}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-content-secondary">{r.hit_count}</td>
                    <td className="px-4 py-2 text-center">
                      <Toggle size="sm" checked={r.active} disabled={toggle.isPending} onChange={() => toggle.mutate(r)} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button type="button" aria-label={t('banking.edit_rule', { defaultValue: 'Edit rule' })} className="rounded p-1 text-content-tertiary hover:text-content-primary" onClick={() => onEdit(r)}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" aria-label={t('common.delete', { defaultValue: 'Delete' })} className="rounded p-1 text-content-tertiary hover:text-semantic-error" onClick={() => setToDelete(r)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ConfirmDialog
        open={!!toDelete}
        title={t('banking.delete_rule', { defaultValue: 'Delete rule?' })}
        message={t('banking.delete_rule_msg', { defaultValue: 'Lines it already booked stay booked.' })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        loading={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </div>
  );
}
