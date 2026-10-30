import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/Badge';
import { MATCH_LABEL, MATCH_VARIANT, type MatchStatus } from './api';

/** 3-way match status chip (bill vs PO price vs received qty). */
export function MatchChip({ status }: { status?: MatchStatus | null }) {
  const { t } = useTranslation();
  const s = status ?? 'none';
  return (
    <Badge size="sm" variant={MATCH_VARIANT[s]}>
      {t(`purchasing.match_${s}`, { defaultValue: MATCH_LABEL[s] })}
    </Badge>
  );
}
