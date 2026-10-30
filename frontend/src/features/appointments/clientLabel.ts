import { useTranslation } from 'react-i18next';
import { useCompanyPresetKey } from '@/app/layout/useCompanyWorkspace';

/** Singular word for the person being booked, by industry preset. */
const CLIENT_WORD: Record<string, [string, string]> = {
  medical_practice: ['appointments.client_patient', 'Patient'],
  small_hotel: ['appointments.client_guest', 'Guest'],
  restaurant_cafe: ['appointments.client_guest', 'Guest'],
  fitness_studio: ['appointments.client_member', 'Member'],
  education_training: ['appointments.client_participant', 'Participant'],
};

export function clientWord(presetKey: string | null): [string, string] {
  return CLIENT_WORD[presetKey ?? ''] ?? ['appointments.client', 'Client'];
}

export function useClientLabel(): string {
  const { t } = useTranslation();
  const [key, fallback] = clientWord(useCompanyPresetKey());
  return t(key, { defaultValue: fallback });
}
