import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { DateDisplay } from '@/shared/ui/DateDisplay';
import type { Receipt } from '../api';
import { StatusBadge, SupplierAvatar } from './common';

const th = 'px-3 py-2.5 text-left font-medium';
const td = 'px-3 py-2';

export function ReceiptsTable({ rows, busy, onBill }: { rows: Receipt[]; busy?: boolean; onBill: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-secondary text-xs uppercase tracking-wide text-content-tertiary">
          <tr>
            <th className={th}>{t('purchasing.col_number', { defaultValue: 'Number' })}</th>
            <th className={th}>{t('purchasing.col_supplier', { defaultValue: 'Supplier' })}</th>
            <th className={th}>{t('purchasing.col_date', { defaultValue: 'Date' })}</th>
            <th className={th}>{t('purchasing.col_order', { defaultValue: 'Order' })}</th>
            <th className={th}>{t('purchasing.col_status', { defaultValue: 'Status' })}</th>
            <th className={`${th} text-right`}>{t('purchasing.col_lines', { defaultValue: 'Lines' })}</th>
            <th className={`${th} text-right`}>{t('purchasing.col_value', { defaultValue: 'Value' })}</th>
            <th className="w-32" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border-light hover:bg-surface-secondary">
              <td className={`${td} font-mono text-xs`}>{r.number}</td>
              <td className={td}>
                <span className="flex items-center gap-2">
                  <SupplierAvatar name={r.supplier_name} />
                  {r.supplier_name || '—'}
                </span>
              </td>
              <td className={`${td} text-content-secondary`}><DateDisplay value={r.doc_date} /></td>
              <td className={`${td} font-mono text-xs`}>
                <Link to={`/purchasing/orders/${r.order_id}`} className="hover:underline">{r.order_number}</Link>
              </td>
              <td className={td}><StatusBadge status={r.status} size="sm" /></td>
              <td className={`${td} text-right tabular-nums text-content-secondary`}>{r.lines?.length ?? 0}</td>
              <td className={`${td} text-right tabular-nums`}><MoneyDisplay amount={r.value_total} currency={r.currency} /></td>
              <td className={`${td} text-right`}>
                <Button size="sm" variant="ghost" icon={<FileText size={14} />} disabled={busy} onClick={() => onBill(r.id)}>
                  {t('purchasing.action_bill', { defaultValue: 'Create bill' })}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
