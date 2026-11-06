import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { activityText, checkText } from './activity';

// Echoes the key and the interpolated default so the tests do not depend on a locale bundle.
const t = ((key: string, o?: { defaultValue?: string } & Record<string, unknown>) =>
  `${key}|${(o?.defaultValue ?? '').replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(o?.[k] ?? ''))}`) as unknown as TFunction;

describe('activityText', () => {
  it('renders from the code and params', () => {
    const a = { at: '', type: 'created', actor: null, message: 'Created X', params: { number: 'INV-1' }, ref_id: null };
    expect(activityText(t, a)).toBe('salesfeed.created|Created INV-1');
  });
  it('falls back to the server text without params', () => {
    const a = { at: '', type: 'created', actor: null, message: 'Created X', ref_id: null };
    expect(activityText(t, a)).toBe('Created X');
  });
});

describe('checkText', () => {
  it('maps field codes and line numbers', () => {
    expect(checkText(t, { field: 'line_3_qty', message: 'x' })).toBe('invcheck.line_qty|Position 3 has no quantity.');
    expect(checkText(t, { field: 'tax_id', message: 'x' })).toContain('invcheck.tax_id|');
  });
  it('keeps unknown server messages', () => {
    expect(checkText(t, { field: 'other', message: 'Server text' })).toBe('Server text');
  });
});
