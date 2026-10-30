import { describe, expect, it } from 'vitest';
import { cleanMapping } from './api';
import { allocated, canWriteOff, confidenceOf, csvHeaders, guessMapping, keyAction, openAmount } from './logic';

describe('reconciliation helpers', () => {
  it('maps scores to confidence bands', () => {
    expect([confidenceOf(0.9), confidenceOf(0.5), confidenceOf(0.2)]).toEqual(['high', 'medium', 'low']);
  });

  it('computes the open part of a line regardless of sign', () => {
    expect(openAmount({ amount: '-119.00', matched_amount: '19.00' })).toBe(100);
    expect(openAmount({ amount: '50.10', matched_amount: '0' })).toBe(50.1);
  });

  it('keyboard map moves within bounds, picks, confirms and ignores', () => {
    expect(keyAction('j', 0, 3)).toEqual({ type: 'move', index: 1 });
    expect(keyAction('ArrowDown', 2, 3)).toEqual({ type: 'move', index: 2 });
    expect(keyAction('k', 0, 3)).toEqual({ type: 'move', index: 0 });
    expect(keyAction('2', 0, 3)).toEqual({ type: 'pick', index: 1 });
    expect(keyAction('Enter', 0, 3)).toEqual({ type: 'confirm' });
    expect(keyAction('x', 0, 3)).toEqual({ type: 'ignore' });
    expect(keyAction('q', 0, 3)).toEqual({ type: 'none' });
  });

  it('write-off is offered only for small non-zero differences', () => {
    const s = { score: 0.8, allocations: [], reasons: [], difference: '1.50', is_split: false };
    expect(canWriteOff(s, 5)).toBe(true);
    expect(canWriteOff({ ...s, difference: '0.00' }, 5)).toBe(false);
    expect(canWriteOff({ ...s, difference: '9.00' }, 5)).toBe(false);
    expect(allocated([{ kind: 'sales_invoice', id: 'a', number: 'X', amount: '0.10' }, { kind: 'sales_invoice', id: 'b', number: 'Y', amount: '0.20' }])).toBe(0.3);
  });

  it('reads CSV headers and guesses a mapping', () => {
    const { delimiter, headers } = csvHeaders('Buchungstag;Wertstellung;Empfänger/Auftraggeber;IBAN;Verwendungszweck;Betrag');
    expect(delimiter).toBe(';');
    const m = guessMapping(headers);
    expect(m).toMatchObject({
      date: 'Buchungstag', value_date: 'Wertstellung', amount: 'Betrag',
      counterparty_name: 'Empfänger/Auftraggeber', counterparty_iban: 'IBAN', remittance: 'Verwendungszweck',
    });
    expect(cleanMapping({ date: 'd', amount: '', debit: undefined })).toEqual({ date: 'd' });
  });
});
