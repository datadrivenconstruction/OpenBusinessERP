/** Industry wording for the business-pack menu rows and page titles, keyed by preset. */

export interface Term {
  key: string;
  defaultLabel: string;
}

type Route = '/contacts' | '/crm' | '/sales';

const term = (slug: string, defaultLabel: string): Term => ({ key: `shell.term_${slug}`, defaultLabel });

const CLIENTS = term('clients', 'Clients');
const FEE_NOTES = term('fee_notes', 'Fee notes');
const MANDATES = term('mandates', 'Mandates');

export const TERMINOLOGY: Readonly<Record<string, Partial<Record<Route, Term>>>> = {
  professional_services: { '/contacts': CLIENTS },
  it_agency: { '/contacts': CLIENTS },
  creative_studio: { '/contacts': CLIENTS },
  law_firm: { '/contacts': CLIENTS, '/crm': term('matter_intake', 'Matter intake'), '/sales': FEE_NOTES },
  tax_advisory: { '/contacts': CLIENTS, '/crm': MANDATES, '/sales': FEE_NOTES },
  real_estate: { '/contacts': term('owners_tenants', 'Owners & tenants'), '/crm': MANDATES },
  craft_trades: { '/crm': term('enquiries', 'Enquiries') },
  medical_practice: {
    '/contacts': term('patients', 'Patients'),
    '/crm': term('referrals', 'Referrals'),
    '/sales': term('cost_plans_invoices', 'Cost plans & invoices'),
  },
  therapy_wellness: { '/contacts': CLIENTS, '/sales': term('packages_invoices', 'Packages & invoices') },
  beauty_salon: { '/contacts': CLIENTS },
  restaurant_cafe: { '/contacts': term('guests', 'Guests'), '/sales': term('events_invoices', 'Events & invoices') },
  small_hotel: {
    '/contacts': term('guests', 'Guests'),
    '/sales': term('bookings_invoices', 'Bookings & invoices'),
  },
  fitness_studio: {
    '/contacts': term('members', 'Members'),
    '/sales': term('memberships_invoices', 'Memberships & invoices'),
  },
  education_training: {
    '/contacts': term('participants', 'Participants'),
    '/sales': term('enrolments_invoices', 'Enrolments & invoices'),
  },
  nonprofit: { '/contacts': term('members_donors', 'Members & donors'), '/crm': term('fundraising', 'Fundraising') },
};

/** The industry label for a menu route, or undefined when the shared wording applies. */
export function termFor(presetKey: string | null, route: string): Term | undefined {
  if (!presetKey) return undefined;
  return TERMINOLOGY[presetKey]?.[route as Route];
}
