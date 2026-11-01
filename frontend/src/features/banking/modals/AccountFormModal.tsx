import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, WideModal, WideModalField, WideModalSection } from '@/shared/ui';
import { Toggle } from '@/shared/ui/Toggle';
import { getErrorMessage } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { bankingApi, type BankAccount } from '../api';
import { DateField } from '@/shared/ui/DateField';

export const inputCls =
  'h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue disabled:opacity-60';

/** Loose IBAN shape check (country + check digits + 10–30 alphanumerics); the bank validates the rest. */
export function ibanLooksValid(iban: string): boolean {
  const v = iban.replace(/\s+/g, '').toUpperCase();
  return v === '' || /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v);
}

/** Only the fields that changed, so an edit never rewrites what someone else changed meanwhile. */
export function accountPatch(form: AccountForm, base: AccountForm): Partial<BankAccount> {
  const out: Partial<BankAccount> = {};
  if (form.name !== base.name) out.name = form.name.trim();
  if (form.bic !== base.bic) out.bic = form.bic.trim().toUpperCase();
  if (form.currency !== base.currency) out.currency = form.currency;
  if (form.gl_account_code !== base.gl_account_code) out.gl_account_code = form.gl_account_code.trim();
  if (form.active !== base.active) out.active = form.active;
  if (form.opening_balance !== base.opening_balance || form.opening_balance_date !== base.opening_balance_date) {
    out.opening_balance = form.opening_balance.trim() || '0';
    out.opening_balance_date = form.opening_balance_date || null;
  }
  return out;
}

export interface AccountForm {
  name: string;
  iban: string;
  bic: string;
  currency: string;
  gl_account_code: string;
  active: boolean;
  opening_balance: string;
  opening_balance_date: string;
}

const baseOf = (a?: BankAccount): AccountForm => ({
  name: a?.name ?? '',
  iban: a?.iban ?? '',
  bic: a?.bic ?? '',
  currency: a?.currency ?? 'EUR',
  gl_account_code: a?.gl_account_code ?? '',
  active: a?.active ?? true,
  opening_balance: a?.opening_balance ?? '0',
  opening_balance_date: a?.opening_balance_date ?? '',
});

export function AccountFormModal({ existing, onClose }: { existing?: BankAccount; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const base = baseOf(existing);
  const [form, setForm] = useState<AccountForm>(base);
  const [error, setError] = useState<string | null>(null);
  const ibanOk = ibanLooksValid(form.iban);
  const save = useMutation({
    mutationFn: () =>
      existing
        ? bankingApi.updateAccount(existing.id, accountPatch(form, base))
        : bankingApi.createAccount({
            name: form.name.trim(), iban: form.iban, bic: form.bic, currency: form.currency,
            gl_account_code: form.gl_account_code || undefined,
            opening_balance: form.opening_balance.trim() || '0',
            opening_balance_date: form.opening_balance_date || null,
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['banking'] });
      addToast({
        type: 'success',
        title: existing
          ? t('banking.account_saved', { defaultValue: 'Account updated' })
          : t('banking.account_created', { defaultValue: 'Account added' }),
      });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  const set = <K extends keyof AccountForm>(k: K, v: AccountForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <WideModal
onSubmit={() => { if (form.name.trim() && ibanOk && !save.isPending) { setError(null); save.mutate(); } }}
      open
      onClose={onClose}
      busy={save.isPending}
      size="md"
      title={existing ? t('banking.edit_account', { defaultValue: 'Edit account' }) : t('banking.add_account', { defaultValue: 'Add account' })}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button size="sm" loading={save.isPending} disabled={!form.name.trim() || !ibanOk} onClick={() => { setError(null); save.mutate(); }}>
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
        </>
      }
    >
      <WideModalSection columns={2}>
        <WideModalField label={t('banking.col_name', { defaultValue: 'Name' })} required span={2}>
          <input className={inputCls} value={form.name} autoFocus onChange={(e) => set('name', e.target.value)} />
        </WideModalField>
        <WideModalField
          label="IBAN"
          hint={existing ? t('banking.iban_locked', { defaultValue: 'The IBAN identifies the account and cannot change.' }) : undefined}
          error={ibanOk ? undefined : t('banking.iban_invalid', { defaultValue: 'This does not look like an IBAN' })}
        >
          <input className={`${inputCls} font-mono`} value={form.iban} disabled={!!existing} onChange={(e) => set('iban', e.target.value.toUpperCase())} />
        </WideModalField>
        <WideModalField label="BIC">
          <input className={`${inputCls} font-mono`} maxLength={11} value={form.bic} onChange={(e) => set('bic', e.target.value.toUpperCase())} />
        </WideModalField>
        <WideModalField label={t('banking.col_currency', { defaultValue: 'Currency' })}>
          <input className={inputCls} maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
        </WideModalField>
        <WideModalField
          label={t('banking.col_gl', { defaultValue: 'GL account' })}
          hint={t('banking.gl_hint', { defaultValue: 'Leave empty to use the bank account from your chart.' })}
        >
          <input className={inputCls} value={form.gl_account_code} onChange={(e) => set('gl_account_code', e.target.value)} />
        </WideModalField>
        <WideModalField
          label={t('banking.opening_balance', { defaultValue: 'Opening balance' })}
          hint={t('banking.opening_balance_hint', { defaultValue: 'Balance before the first imported line. Set automatically from the first camt/MT940 statement.' })}
        >
          <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={form.opening_balance} onChange={(e) => set('opening_balance', e.target.value.replace(',', '.'))} />
        </WideModalField>
        <WideModalField label={t('banking.opening_balance_date', { defaultValue: 'Opening balance date' })}>
          <DateField className={inputCls} value={form.opening_balance_date} onChange={(e) => set('opening_balance_date', e.target.value)} />
        </WideModalField>
        {existing && (
          <WideModalField label={t('banking.active', { defaultValue: 'Active' })}>
            <Toggle checked={form.active} onChange={(v: boolean) => set('active', v)} />
          </WideModalField>
        )}
      </WideModalSection>
      {error && <p className="mt-3 text-sm text-semantic-error">{error}</p>}
    </WideModal>
  );
}
