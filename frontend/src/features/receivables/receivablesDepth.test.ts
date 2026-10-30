import { describe, expect, it } from 'vitest';
import { bucketShares, filterByBucket, previewByLevel } from './api';
import { validateFollowUp } from './modals/FollowUpModal';

const row = (current: string, d1_30: string, d90_plus = '0') => ({
  current, d1_30, d31_60: '0', d61_90: '0', d90_plus,
  total: String(Number(current) + Number(d1_30) + Number(d90_plus)),
});

describe('receivables depth helpers', () => {
  it('filters customers by a clicked bucket or by anything past due', () => {
    const rows = [row('100', '0'), row('0', '50'), row('0', '0', '10')];
    expect(filterByBucket(rows, null)).toHaveLength(3);
    expect(filterByBucket(rows, 'd1_30')).toEqual([rows[1]]);
    expect(filterByBucket(rows, 'overdue')).toEqual([rows[1], rows[2]]);
  });

  it('splits the total into bucket shares', () => {
    const s = bucketShares({ current: '50', d1_30: '25', d31_60: '25', d61_90: '0', d90_plus: '0', total: '100' });
    expect(s).toEqual({ current: 50, d1_30: 25, d31_60: 25, d61_90: 0, d90_plus: 0 });
    expect(bucketShares({ current: '0', d1_30: '0', d31_60: '0', d61_90: '0', d90_plus: '0', total: '0' }).current).toBe(0);
  });

  it('counts preview drafts per level', () => {
    expect([...previewByLevel([{ level: 1 }, { level: 2 }, { level: 1 }])]).toEqual([[1, 2], [2, 1]]);
  });

  it('requires a date and positive amount for promises and text for notes', () => {
    expect(validateFollowUp({ kind: 'note', text: ' ' })).toHaveProperty('text');
    expect(validateFollowUp({ kind: 'promise', promised_date: null, promised_amount: '0' })).toEqual({
      promised_date: 'receivables.err_promise_date',
      promised_amount: 'receivables.err_promise_amount',
    });
    expect(validateFollowUp({ kind: 'promise', promised_date: '2026-11-01', promised_amount: '12,50' })).toEqual({});
  });
});
