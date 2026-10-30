/** Guided business playbooks: each step opens a real screen of the app. */

export type BizSection = 'trade' | 'services' | 'health' | 'hospitality' | 'public';
export type BizDiscipline = 'setup' | 'sales' | 'purchasing' | 'finance' | 'operations';

export interface BizStep { title: string; body: string; route: string; look: string }
export interface BizCase {
  id: string;
  title: string;
  summary: string;
  discipline: BizDiscipline;
  /** Preset keys, or '*' for every business company. */
  industries: readonly string[];
  minutes: number;
  steps: readonly BizStep[];
}

export const BIZ_SECTIONS: Record<BizSection, readonly string[]> = {
  trade: ['trade_distribution', 'retail_ecommerce', 'manufacturing', 'craft_trades', 'food_production', 'franchise_multisite'],
  services: ['professional_services', 'law_firm', 'tax_advisory', 'it_agency', 'creative_studio', 'real_estate', 'field_service', 'logistics'],
  health: ['medical_practice', 'therapy_wellness', 'beauty_salon'],
  hospitality: ['restaurant_cafe', 'small_hotel', 'fitness_studio'],
  public: ['education_training', 'nonprofit'],
};

export const BIZ_DISCIPLINES: readonly BizDiscipline[] = ['setup', 'sales', 'purchasing', 'finance', 'operations'];

export function sectionOf(preset: string | null): BizSection | null {
  for (const [sec, keys] of Object.entries(BIZ_SECTIONS)) if (preset && keys.includes(preset)) return sec as BizSection;
  return null;
}

/** Industries a section filter covers; null = all. */
export function caseMatches(c: BizCase, section: BizSection | null): boolean {
  if (!section || c.industries.includes('*')) return true;
  return c.industries.some((k) => BIZ_SECTIONS[section].includes(k));
}

const S = (title: string, route: string, body: string, look: string): BizStep => ({ title, route, body, look });
const ALL = ['*'];

export const BUSINESS_CASES: readonly BizCase[] = [
  // ── Common to every business ──────────────────────────────────────────
  { id: 'setup-company', title: 'Set up your company', discipline: 'setup', industries: ALL, minutes: 15,
    summary: 'Enter the legal details, numbering and accounts the rest of the app relies on.',
    steps: [
      S('Company details', '/settings?tab=company', 'Fill in legal name, address, tax ID and base currency.', 'The company name appears in the header of your home page.'),
      S('Document settings', '/settings', 'Choose number sequences, payment terms and the footer printed on quotes and invoices.', 'A preview number such as INV-0001 for the next invoice.'),
      S('Chart of accounts', '/accounting/accounts', 'Review the accounts created for your country and add any you need.', 'Revenue, receivables, bank and VAT accounts all present.'),
      S('Invite your team', '/users', 'Add colleagues and give each a role.', 'Each invitee listed with a pending status.'),
    ] },
  { id: 'import-master-data', title: 'Import customers & products', discipline: 'setup', industries: ALL, minutes: 10,
    summary: 'Bring your existing customer list and price list in from a spreadsheet.',
    steps: [
      S('Prepare the file', '/import', 'Download the template, paste your data and keep one row per record.', 'Column headers that match the template.'),
      S('Import customers', '/import?target=customers', 'Upload the file and map any unmatched columns.', 'The dry-run count equals the rows in your file.'),
      S('Import products', '/import?target=products', 'Repeat with your products or services and their prices.', 'No rows flagged with a missing price or unit.'),
      S('Check the result', '/contacts', 'Open a few imported customers and confirm addresses and tax IDs.', 'No duplicates of customers you already had.'),
    ] },
  { id: 'quote-to-cash', title: 'Quote → order → invoice → payment', discipline: 'sales', industries: ALL, minutes: 12,
    summary: 'Follow one sale from the first offer to the money in the bank.',
    steps: [
      S('Write a quote', '/sales/quotes/new', 'Pick the customer, add lines and send the quote.', 'Totals with tax calculated per line.'),
      S('Convert to an order', '/sales?tab=quotes', 'When the customer accepts, turn the quote into an order.', 'The quote status changes to accepted.'),
      S('Invoice the order', '/sales?tab=orders', 'Create the invoice from the order, fully or in part.', 'An invoice number from your sequence.'),
      S('Record the payment', '/receivables', 'Register the incoming payment against the invoice.', 'The open balance drops to zero.'),
    ] },
  { id: 'invoice-pdf-email', title: 'Send an invoice as PDF by e-mail', discipline: 'sales', industries: ALL, minutes: 5,
    summary: 'Produce a clean PDF and deliver it straight to the customer.',
    steps: [
      S('Open the invoice', '/sales?tab=invoices', 'Find the invoice in the list and open it.', 'Status is issued, not draft.'),
      S('Preview the PDF', '/sales?tab=invoices', 'Check logo, bank details and payment terms on the preview.', 'Your IBAN and due date on the page.'),
      S('Send by e-mail', '/sales?tab=invoices', 'Use Send, adjust the message and confirm the recipient.', 'A sent timestamp on the invoice.'),
    ] },
  { id: 'procure-to-pay', title: 'Purchase order → receipt → supplier bill', discipline: 'purchasing', industries: ALL, minutes: 12,
    summary: 'Order from a supplier, confirm delivery and book the bill.',
    steps: [
      S('Raise a purchase order', '/purchasing/orders/new', 'Choose the supplier, items, quantities and expected date.', 'The order total and delivery date.'),
      S('Receive the goods', '/purchasing?tab=orders', 'Mark what arrived; partial deliveries stay open.', 'Received quantity per line.'),
      S('Enter the supplier bill', '/purchasing/bills/new', 'Match the bill to the order and check prices.', 'No price difference warnings.'),
      S('Schedule the payment', '/banking', 'Plan the outgoing payment by the due date.', 'The bill listed under payables.'),
    ] },
  { id: 'bank-reconcile', title: 'Reconcile the bank statement', discipline: 'finance', industries: ALL, minutes: 15,
    summary: 'Match every bank line to an invoice, bill or journal entry.',
    steps: [
      S('Load the statement', '/banking', 'Import the statement file or sync the account.', 'Opening balance equal to last closing balance.'),
      S('Accept suggested matches', '/banking', 'Confirm lines the app paired with open invoices and bills.', 'Amounts and references agree.'),
      S('Book the rest', '/accounting/journal/new', 'Post bank fees, interest and other unmatched lines.', 'An expense account on every entry.'),
      S('Close the statement', '/banking', 'Finish when nothing is left unmatched.', 'Book balance equals bank balance.'),
    ] },
  { id: 'chase-overdue', title: 'Chase overdue invoices', discipline: 'finance', industries: ALL, minutes: 8,
    summary: 'Find who owes you, remind them politely and log what was agreed.',
    steps: [
      S('Review the ageing', '/receivables', 'Sort open invoices by days overdue.', 'The oldest and largest amounts first.'),
      S('Send reminders', '/receivables', 'Send a reminder with the invoice attached.', 'A reminder count on each invoice.'),
      S('Log a follow-up', '/tasks', 'Create a task for a call if there is no reply in a week.', 'The task due date on your home page.'),
    ] },
  { id: 'month-end', title: 'Month-end close & reports', discipline: 'finance', industries: ALL, minutes: 20,
    summary: 'Tidy up the month and read the numbers that matter.',
    steps: [
      S('Finish reconciliation', '/banking', 'Make sure every bank account is reconciled to month end.', 'No open statement lines.'),
      S('Post adjustments', '/accounting/journal/new', 'Book accruals, depreciation and prepaid items.', 'Balanced debit and credit.'),
      S('Trial balance', '/accounting/reports', 'Run the trial balance and investigate odd balances.', 'Suspense and clearing accounts at zero.'),
      S('Profit & loss and balance sheet', '/accounting/reports', 'Compare the month with the previous one.', 'Margin movements you can explain.'),
    ] },
  { id: 'online-booking', title: 'Set up online booking', discipline: 'setup', industries: ['medical_practice', 'therapy_wellness', 'beauty_salon', 'fitness_studio', 'professional_services', 'law_firm', 'tax_advisory', 'education_training', 'field_service', 'small_hotel'], minutes: 10,
    summary: 'Let clients pick a free slot themselves.',
    steps: [
      S('Define services', '/appointments', 'Add each service with its length and price.', 'Durations that match how you really work.'),
      S('Set opening hours', '/appointments', 'Enter working hours and breaks per staff member.', 'Free slots shown on the calendar.'),
      S('Share the booking link', '/appointments', 'Copy the public link and put it on your website.', 'A test booking appearing in the calendar.'),
    ] },
  { id: 'payroll-run', title: 'Run monthly payroll', discipline: 'finance', industries: ALL, minutes: 15,
    summary: 'Pay your staff and book the wage costs.',
    steps: [
      S('Check hours', '/field-time', 'Review recorded hours and absences for the period.', 'No missing days.'),
      S('Calculate payroll', '/payroll', 'Run the payroll for the month and review payslips.', 'Net pay per employee.'),
      S('Post to accounts', '/accounting/reports', 'Confirm wage costs appear in the profit and loss.', 'Wages in the right month.'),
    ] },
  // ── Industry-specific ─────────────────────────────────────────────────
  { id: 'medical-day', title: 'A day at the medical practice', discipline: 'operations', industries: ['medical_practice', 'therapy_wellness'], minutes: 10,
    summary: 'From the morning schedule to billed visits at closing time.',
    steps: [
      S('Morning schedule', '/appointments', 'Open today’s list and confirm arrivals.', 'Gaps you can offer to waiting patients.'),
      S('Patient record', '/contacts', 'Check contact and insurance details at check-in.', 'An up-to-date billing address.'),
      S('Bill the visits', '/sales?tab=invoices', 'Invoice completed visits for self-paying patients.', 'One invoice per visit.'),
      S('Day total', '/receivables', 'Check what was paid today and what is still open.', 'Card and cash totals that agree with the till.'),
    ] },
  { id: 'salon-booking-invoice', title: 'Salon: booking to invoice', discipline: 'sales', industries: ['beauty_salon', 'fitness_studio', 'therapy_wellness'], minutes: 6,
    summary: 'Turn a booked treatment into a paid receipt.',
    steps: [
      S('Take the booking', '/appointments', 'Book the client with the right stylist and service.', 'The slot blocked in the calendar.'),
      S('Add retail products', '/sales?tab=invoices', 'At checkout add any products sold with the service.', 'Stock lines next to the service line.'),
      S('Take payment', '/receivables', 'Record card or cash payment.', 'Invoice marked paid.'),
    ] },
  { id: 'craft-job', title: 'Craft job: enquiry to invoice', discipline: 'operations', industries: ['craft_trades', 'field_service'], minutes: 12,
    summary: 'Handle a repair or installation job end to end.',
    steps: [
      S('Log the enquiry', '/crm', 'Create the lead with the address and a short description.', 'The lead in the new column.'),
      S('Send the estimate', '/sales/quotes/new', 'Price labour and materials and send it.', 'Separate labour and material lines.'),
      S('Plan the visit', '/tasks', 'Assign the job to a technician with a date.', 'The task in the technician’s list.'),
      S('Record time', '/field-time', 'Book hours spent on site.', 'Hours linked to the job.'),
      S('Invoice the job', '/sales?tab=orders', 'Invoice from the order including extra work.', 'Final amount versus estimate.'),
    ] },
  { id: 'restaurant-takings', title: 'Restaurant weekly takings', discipline: 'finance', industries: ['restaurant_cafe', 'food_production', 'franchise_multisite'], minutes: 10,
    summary: 'Book a week of till takings and check food cost.',
    steps: [
      S('Import till totals', '/import', 'Load daily sales totals from your till export.', 'Seven daily rows.'),
      S('Match card settlements', '/banking', 'Pair card provider payouts with daily takings.', 'Fees booked separately.'),
      S('Supplier bills', '/purchasing?tab=bills', 'Enter the week’s food and drink bills.', 'Every delivery has a bill.'),
      S('Check margins', '/accounting/reports', 'Compare purchases against sales for the week.', 'Food cost as a share of sales.'),
    ] },
  { id: 'wholesale-reorder', title: 'Wholesale reorder', discipline: 'purchasing', industries: ['trade_distribution', 'retail_ecommerce', 'manufacturing', 'food_production'], minutes: 8,
    summary: 'Restock fast-moving items before they run out.',
    steps: [
      S('Find low items', '/purchasing', 'Review items whose sales outpace stock.', 'Items below their reorder level.'),
      S('Order from the supplier', '/purchasing/orders/new', 'Bundle the items per supplier in one order.', 'Order quantity rounded to pack sizes.'),
      S('Receive and price', '/purchasing?tab=orders', 'Receive goods and check landed cost.', 'Updated purchase prices.'),
    ] },
  { id: 'agency-retainer', title: 'Agency retainer billing', discipline: 'sales', industries: ['it_agency', 'creative_studio', 'professional_services'], minutes: 10,
    summary: 'Bill a monthly retainer and track hours used against it.',
    steps: [
      S('Agree the retainer', '/sales/quotes/new', 'Quote the monthly fee and included hours.', 'Fee and hours on one line.'),
      S('Track hours', '/field-time', 'Team members log time against the client.', 'Hours used to date.'),
      S('Monthly invoice', '/sales?tab=invoices', 'Invoice the fee plus any overage.', 'Overage only above the included hours.'),
    ] },
  { id: 'nonprofit-grant', title: 'Nonprofit grant tracking', discipline: 'finance', industries: ['nonprofit', 'education_training'], minutes: 12,
    summary: 'Keep each grant’s spending separate and ready for the funder.',
    steps: [
      S('Register the grant', '/accounting/accounts', 'Create an income account or tag for the grant.', 'The grant amount as expected income.'),
      S('Code expenses', '/purchasing?tab=bills', 'Assign bills to the grant when entering them.', 'Every grant cost tagged.'),
      S('Funder report', '/accounting/reports', 'Filter the report to the grant.', 'Remaining budget for the grant.'),
    ] },
  { id: 'hotel-stay', title: 'Hotel guest stay', discipline: 'operations', industries: ['small_hotel'], minutes: 8,
    summary: 'From reservation to the folio paid at checkout.',
    steps: [
      S('Reservation', '/appointments', 'Book the room for the stay dates.', 'No overlap with other guests.'),
      S('Guest details', '/contacts', 'Store the guest’s name, address and ID details.', 'Billing address for the folio.'),
      S('Checkout invoice', '/sales?tab=invoices', 'Invoice nights, breakfast and extras.', 'Tourist tax as its own line if it applies.'),
      S('Payment', '/receivables', 'Record payment at checkout.', 'Folio balance zero.'),
    ] },
  { id: 'law-fee-note', title: 'Law firm fee note', discipline: 'sales', industries: ['law_firm', 'tax_advisory'], minutes: 10,
    summary: 'Turn recorded time on a matter into a fee note.',
    steps: [
      S('Open the matter', '/projects', 'Create or open the client matter.', 'Client and responsible lawyer set.'),
      S('Record time', '/field-time', 'Log billable time with a short narrative.', 'Narratives a client can understand.'),
      S('Issue the fee note', '/sales?tab=invoices', 'Bill the unbilled time and disbursements.', 'Hours times rate per line.'),
    ] },
  { id: 'tax-client-year', title: 'Tax adviser: annual client file', discipline: 'operations', industries: ['tax_advisory', 'professional_services'], minutes: 10,
    summary: 'Collect documents, track the deadline and bill the work.',
    steps: [
      S('Request documents', '/documents', 'Create a folder for the client year and upload what arrives.', 'Missing items easy to spot.'),
      S('Track the deadline', '/tasks', 'Add the filing deadline as a task.', 'The due date on your home page.'),
      S('Bill the engagement', '/sales?tab=invoices', 'Invoice the agreed fee.', 'Fee matches the engagement letter.'),
    ] },
  { id: 'retail-returns', title: 'Retail return and credit note', discipline: 'sales', industries: ['retail_ecommerce', 'trade_distribution'], minutes: 5,
    summary: 'Handle a customer return cleanly.',
    steps: [
      S('Find the invoice', '/sales?tab=invoices', 'Look up the original sale.', 'Item and price as sold.'),
      S('Issue a credit note', '/sales?tab=invoices', 'Credit the returned lines.', 'Negative total linked to the invoice.'),
      S('Refund', '/banking', 'Pay back the customer or offset the next invoice.', 'Customer balance zero.'),
    ] },
  { id: 'manufacturing-order', title: 'Make-to-order production', discipline: 'operations', industries: ['manufacturing', 'food_production'], minutes: 12,
    summary: 'Buy materials for a customer order and bill on delivery.',
    steps: [
      S('Confirm the order', '/sales?tab=orders', 'Record the customer order and delivery date.', 'Delivery date you can meet.'),
      S('Order materials', '/purchasing/orders/new', 'Buy the raw materials needed.', 'Materials arrive before production.'),
      S('Plan production', '/tasks', 'Schedule production steps as tasks.', 'Owner per step.'),
      S('Invoice on delivery', '/sales?tab=orders', 'Invoice when the goods ship.', 'Order fully invoiced.'),
    ] },
  { id: 'real-estate-rent', title: 'Monthly rent run', discipline: 'finance', industries: ['real_estate'], minutes: 10,
    summary: 'Bill tenants and follow up on unpaid rent.',
    steps: [
      S('Tenants list', '/contacts', 'Check tenants and their monthly rent.', 'Every unit has a tenant or is vacant.'),
      S('Issue rent invoices', '/sales?tab=invoices', 'Create the month’s rent invoices.', 'One invoice per tenant.'),
      S('Match payments', '/banking', 'Match incoming transfers to the invoices.', 'Unpaid rent listed under receivables.'),
    ] },
  { id: 'logistics-shipment', title: 'Logistics: shipment to invoice', discipline: 'operations', industries: ['logistics', 'trade_distribution'], minutes: 8,
    summary: 'Quote a transport, deliver it and bill the customer.',
    steps: [
      S('Quote the shipment', '/sales/quotes/new', 'Price distance, weight and extras.', 'Fuel surcharge on its own line.'),
      S('Plan the run', '/tasks', 'Assign driver and date.', 'Driver task for the date.'),
      S('Bill after delivery', '/sales?tab=orders', 'Invoice once proof of delivery is in.', 'Proof attached in documents.'),
    ] },
  { id: 'training-course', title: 'Course enrolment to invoice', discipline: 'sales', industries: ['education_training', 'fitness_studio'], minutes: 8,
    summary: 'Enrol participants and bill course fees.',
    steps: [
      S('Schedule sessions', '/appointments', 'Create the course dates and capacity.', 'Remaining seats shown.'),
      S('Enrol participants', '/contacts', 'Add each participant or their employer.', 'Billing contact for each seat.'),
      S('Invoice fees', '/sales?tab=invoices', 'Invoice the fee per participant.', 'Seats sold equals invoices issued.'),
    ] },
  { id: 'franchise-sites', title: 'Compare franchise sites', discipline: 'finance', industries: ['franchise_multisite', 'restaurant_cafe', 'retail_ecommerce'], minutes: 10,
    summary: 'See how each location performs month by month.',
    steps: [
      S('Tag each site', '/accounting/accounts', 'Use a cost centre per location.', 'Every site has a code.'),
      S('Code income and costs', '/sales?tab=invoices', 'Make sure sales and bills carry the site code.', 'No untagged lines.'),
      S('Read the report', '/accounting/reports', 'Run profit and loss per site.', 'Sites with falling margins.'),
    ] },
  { id: 'customer-pipeline', title: 'Build a sales pipeline', discipline: 'sales', industries: ['professional_services', 'it_agency', 'creative_studio', 'real_estate', 'trade_distribution', 'manufacturing', 'law_firm', 'logistics'], minutes: 8,
    summary: 'Keep track of leads and what to do next with each.',
    steps: [
      S('Add leads', '/crm', 'Create leads with source and estimated value.', 'Leads in the first stage.'),
      S('Plan next actions', '/tasks', 'Set a follow-up for each open lead.', 'No lead without a next step.'),
      S('Quote the hot ones', '/sales/quotes/new', 'Send offers to leads ready to buy.', 'Pipeline value on your home page.'),
    ] },
];

/** Every distinct route base used by the steps (path without query). */
export function caseRoutes(): string[] {
  return [...new Set(BUSINESS_CASES.flatMap((c) => c.steps.map((s) => s.route.split('?')[0]).filter((r): r is string => r !== undefined)))];
}

const PROGRESS_KEY = 'oe_biz_case_progress';
export function loadProgress(): Record<string, number[]> {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') as Record<string, number[]>; } catch { return {}; }
}
export function saveProgress(p: Record<string, number[]>): void {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}
