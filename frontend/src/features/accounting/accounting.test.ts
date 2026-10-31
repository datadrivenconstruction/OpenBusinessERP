import { describe, expect, it } from 'vitest';
import { entryBalance, exportFilename, exportUrl, previousRange, toCsv, validateEntry } from './api';

const L = (account_id: string, debit = '', credit = '') => ({ account_id, description: '', debit, credit });

describe('entry validation', () => {
  it('needs two lines', () => expect(validateEntry([L('a', '10'), L('', '')])).toBe('lines'));
  it('rejects a line with both sides or no account', () => {
    expect(validateEntry([L('a', '10', '10'), L('b', '', '10')])).toBe('line');
    expect(validateEntry([L('', '10'), L('b', '', '10')])).toBe('line');
  });
  it('compares in cents, so 0.1 + 0.2 equals 0.3', () => {
    expect(validateEntry([L('a', '0.1'), L('a', '0.2'), L('b', '', '0.3')])).toBeNull();
    expect(entryBalance([L('a', '10'), L('b', '', '9.99')]).balanced).toBe(false);
  });
});

describe('helpers', () => {
  it('previous range ends the day before and has the same length', () => {
    expect(previousRange('2026-03-01', '2026-03-31')).toEqual({ from: '2026-01-29', to: '2026-02-28' });
  });
  it('quotes csv cells', () => expect(toCsv([['a,b', 'c"d']])).toBe('\uFEFF"a,b","c""d"'));
});

describe('accountant exports', () => {
  it('builds export urls and filenames', () => {
    expect(exportUrl('saft', '2026-01-01', '2026-03-31')).toBe('/api/v1/gl/export/saft/?date_from=2026-01-01&date_to=2026-03-31');
    expect(exportFilename('datev', '2026-01-01', '2026-03-31')).toBe('EXTF_Buchungsstapel_20260101_20260331.csv');
    expect(exportFilename('saft', '2026-01-01', '2026-01-31')).toBe('SAF-T_20260101_20260131.xml');
  });
});
