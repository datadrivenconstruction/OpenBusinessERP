import { useTranslation } from 'react-i18next';

/** Muted reminder that tax/e-invoice/statutory output must be verified by the user. */
export function ComplianceDisclaimer({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={`text-2xs text-content-tertiary ${className}`}>
      {t('common.compliance_disclaimer', {
        defaultValue:
          'Provided as is, not tax or legal advice. Check rates, formats and reports against current law and official specifications before you rely on them.',
      })}
    </p>
  );
}
