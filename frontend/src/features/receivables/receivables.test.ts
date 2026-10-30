import { describe, expect, it } from 'vitest';
import { BUCKETS, mailtoDraft, overdueShare } from './api';

describe('receivables helpers', () => {
  it('lists the five aging buckets in order', () => {
    expect(BUCKETS).toEqual(['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']);
  });

  it('computes the overdue share of a customer row', () => {
    const row = { current: '25', d1_30: '25', d31_60: '50', d61_90: '0', d90_plus: '0', total: '100' };
    expect(overdueShare(row)).toBe(75);
    expect(overdueShare({ ...row, total: '0' })).toBe(0);
  });

  it('builds a mailto draft that only opens the user mail program', () => {
    const href = mailtoDraft({ subject: 'Invoice INV-1', body: 'Hello & thanks' });
    expect(href.startsWith('mailto:?subject=Invoice%20INV-1')).toBe(true);
    expect(href).toContain('body=Hello%20%26%20thanks');
  });
});
