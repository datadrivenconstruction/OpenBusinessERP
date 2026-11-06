/** Loose Leitweg-ID shape; the check digits are left to the buyer's portal. Mirrors backend contacts/leitweg.py. */
const LEITWEG = /^\d{2,12}(-[0-9A-Z]{1,30})?-\d{2}$/;

export function isLeitwegId(value: string): boolean {
  const text = value.trim().toUpperCase();
  return text === '' || LEITWEG.test(text);
}
