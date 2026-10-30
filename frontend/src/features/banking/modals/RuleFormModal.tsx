import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, WideModal, WideModalField, WideModalSection } from '@/shared/ui';
import { Toggle } from '@/shared/ui/Toggle';
import { getErrorMessage } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { bankingApi, type BankRule, type BankRuleInput, type BankTransaction } from '../api';
import { inputCls } from './AccountFormModal';

export const EMPTY_RULE: BankRuleInput = {
  name: '', match_field: 'counterparty', pattern: '', direction: 'any', min_amount: null, max_amount: null,
  account_code: '', memo: '', priority: 100, active: true,
};

/** A rule pre-filled from a bank line, so "always book this counterparty to X" is one click away. */
export function ruleFromLine(line: Pick<BankTransaction, 'counterparty_name' | 'remittance' | 'amount'>): BankRuleInput {
  const byName = line.counterparty_name.trim();
  return {
    ...EMPTY_RULE,
    name: byName || line.remittance.slice(0, 40),
    match_field: byName ? 'counterparty' : 'text',
    pattern: byName || line.remittance.split(/\s+/).slice(0, 3).join(' '),
    direction: Number(line.amount) < 0 ? 'out' : 'in',
  };
}

/** Client-side check matching the server: a /regex/ pattern must compile. */
export function patternError(p: string): boolean {
  const v = p.trim();
  if (!v) return true;
  if (v.length > 2 && v.startsWith('/') && v.endsWith('/')) {
    try {
      new RegExp(v.slice(1, -1));
    } catch {
      return true;
    }
  }
  return false;
}

interface Props {
  existing?: BankRule;
  initial?: BankRuleInput;
  onClose: () => void;
}

export function RuleFormModal({ existing, initial, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [form, setForm] = useState<BankRuleInput>(existing ?? initial ?? EMPTY_RULE);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof BankRuleInput>(k: K, v: BankRuleInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const badPattern = form.pattern !== '' && patternError(form.pattern);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, min_amount: form.min_amount || null, max_amount: form.max_amount || null };
      return existing ? bankingApi.updateRule(existing.id, body) : bankingApi.createRule(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['banking'] });
      addToast({ type: 'success', title: t('banking.rule_saved', { defaultValue: 'Rule saved' }) });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  const valid = form.name.trim() && form.account_code.trim() && form.pattern.trim() && !badPattern;
  return (
    <WideModal
      open
      onClose={onClose}
      busy={save.isPending}
      size="lg"
      title={existing ? t('banking.edit_rule', { defaultValue: 'Edit rule' }) : t('banking.new_rule', { defaultValue: 'New rule' })}
      subtitle={t('banking.rule_sub', { defaultValue: 'Lines that match are booked straight to the account when you apply rules.' })}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button size="sm" loading={save.isPending} disabled={!valid} onClick={() => { setError(null); save.mutate(); }}>
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
        </>
      }
    >
      <WideModalSection title={t('banking.rule_when', { defaultValue: 'When a line…' })} columns={2}>
        <WideModalField label={t('banking.rule_field', { defaultValue: 'Look in' })}>
          <select className={inputCls} value={form.match_field} onChange={(e) => set('match_field', e.target.value as BankRuleInput['match_field'])}>
            <option value="counterparty">{t('banking.rule_field_counterparty', { defaultValue: 'Counterparty name' })}</option>
            <option value="text">{t('banking.rule_field_text', { defaultValue: 'Payment text and reference' })}</option>
            <option value="iban">{t('banking.rule_field_iban', { defaultValue: 'Counterparty IBAN' })}</option>
            <option value="any">{t('banking.rule_field_any', { defaultValue: 'Anywhere' })}</option>
          </select>
        </WideModalField>
        <WideModalField
          label={t('banking.rule_pattern', { defaultValue: 'Contains' })}
          required
          hint={t('banking.rule_pattern_hint', { defaultValue: 'Case and accents are ignored. Wrap in /…/ for a regular expression.' })}
          error={badPattern ? t('banking.rule_pattern_bad', { defaultValue: 'Not a valid regular expression' }) : undefined}
        >
          <input className={inputCls} value={form.pattern} onChange={(e) => set('pattern', e.target.value)} />
        </WideModalField>
        <WideModalField label={t('banking.rule_direction', { defaultValue: 'Direction' })}>
          <select className={inputCls} value={form.direction} onChange={(e) => set('direction', e.target.value as BankRuleInput['direction'])}>
            <option value="any">{t('banking.dir_any', { defaultValue: 'Money in or out' })}</option>
            <option value="in">{t('banking.dir_in', { defaultValue: 'Money in' })}</option>
            <option value="out">{t('banking.dir_out', { defaultValue: 'Money out' })}</option>
          </select>
        </WideModalField>
        <WideModalField label={t('banking.rule_amount_range', { defaultValue: 'Amount between' })}>
          <div className="flex items-center gap-2">
            <input className={inputCls} inputMode="decimal" placeholder="0" value={form.min_amount ?? ''} onChange={(e) => set('min_amount', e.target.value.replace(',', '.') || null)} />
            <span className="text-content-tertiary">–</span>
            <input className={inputCls} inputMode="decimal" placeholder="∞" value={form.max_amount ?? ''} onChange={(e) => set('max_amount', e.target.value.replace(',', '.') || null)} />
          </div>
        </WideModalField>
      </WideModalSection>
      <WideModalSection title={t('banking.rule_then', { defaultValue: '…book it to' })} columns={2}>
        <WideModalField label={t('banking.account_code', { defaultValue: 'Account' })} required>
          <input className={inputCls} value={form.account_code} onChange={(e) => set('account_code', e.target.value)} />
        </WideModalField>
        <WideModalField label={t('banking.rule_memo', { defaultValue: 'Booking text' })}>
          <input className={inputCls} value={form.memo} onChange={(e) => set('memo', e.target.value)} />
        </WideModalField>
        <WideModalField label={t('banking.rule_name', { defaultValue: 'Rule name' })} required>
          <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </WideModalField>
        <WideModalField
          label={t('banking.rule_priority', { defaultValue: 'Priority' })}
          hint={t('banking.rule_priority_hint', { defaultValue: 'Lower runs first when several rules match.' })}
        >
          <input className={inputCls} inputMode="numeric" value={form.priority} onChange={(e) => set('priority', Number(e.target.value.replace(/\D/g, '')) || 0)} />
        </WideModalField>
        <WideModalField label={t('banking.active', { defaultValue: 'Active' })}>
          <Toggle checked={form.active} onChange={(v) => set('active', v)} />
        </WideModalField>
      </WideModalSection>
      {error && <p className="mt-3 text-sm text-semantic-error">{error}</p>}
    </WideModal>
  );
}
