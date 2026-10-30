import { describe, it, expect } from 'vitest';
import { defaultTaxRate } from './taxDefaults';

describe('defaultTaxRate', () => {
  it('maps common countries', () => {
    expect(defaultTaxRate('DE')).toBe(19);
    expect(defaultTaxRate('ch')).toBe(8.1);
    expect(defaultTaxRate('FI')).toBe(25.5);
    expect(defaultTaxRate('CA')).toBe(5);
  });
  it('returns 0 for US, unknown and empty', () => {
    expect(defaultTaxRate('US')).toBe(0);
    expect(defaultTaxRate('ZZ')).toBe(0);
    expect(defaultTaxRate(null)).toBe(0);
    expect(defaultTaxRate('')).toBe(0);
  });
});
