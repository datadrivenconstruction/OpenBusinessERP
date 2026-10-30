import { describe, expect, it } from 'vitest';
import { applyPreset, errorsToCsv, missingAmount, missingRequired, normalizeHeader, setColumn } from './mapping';

describe('import mapping helpers', () => {
  it('normalizes headers across languages', () => {
    expect(normalizeHeader('USt-IdNr.')).toBe('ustidnr');
    expect(normalizeHeader('Straße')).toBe('strasse');
    expect(normalizeHeader('Numéro client')).toBe('numeroclient');
    expect(normalizeHeader('Номер клиента')).toBe('номерклиента');
  });

  it('applies a preset loosely and keeps fields unique', () => {
    const m = applyPreset(['kundennummer', 'Firma', 'E-Mail'], { Kundennummer: 'customer_number', 'E-mail': 'email' }, {
      Firma: 'name',
      Other: 'email',
    });
    expect(m).toEqual({ Firma: 'name', kundennummer: 'customer_number', 'E-Mail': 'email' });
  });

  it('sets and clears a column', () => {
    let m = setColumn({ A: 'name', B: 'email' }, 'C', 'email');
    expect(m).toEqual({ A: 'name', C: 'email' });
    m = setColumn(m, 'A', '');
    expect(m).toEqual({ C: 'email' });
  });

  it('reports missing required fields and amounts', () => {
    const fields = [
      { key: 'sku', label: 'SKU', required: true },
      { key: 'name', label: 'Name', required: true },
      { key: 'uom', label: 'Unit', required: false },
    ];
    expect(missingRequired(fields, { X: 'sku' }).map((f) => f.key)).toEqual(['name']);
    expect(missingAmount('opening_balances', { A: 'account_code' })).toBe(true);
    expect(missingAmount('opening_balances', { A: 'account_code', B: 'balance' })).toBe(false);
    expect(missingAmount('items', {})).toBe(false);
  });

  it('exports errors as CSV with BOM and quoting', () => {
    const csv = errorsToCsv([{ row: 3, message: 'E-mail: invalid "x;y"' }, { row: 0, message: 'Unbalanced' }]);
    expect(csv.startsWith('\uFEFFRow;Error\r\n')).toBe(true);
    expect(csv).toContain('3;"E-mail: invalid ""x;y"""');
    expect(csv).toContain('\r\n;Unbalanced\r\n');
  });
});
