import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BUSINESS_CASES, BIZ_SECTIONS, caseRoutes } from '../businessCases';

vi.mock('@/app/layout/useCompanyWorkspace', () => ({ useCompanyPresetKey: () => 'beauty_salon' }));
import { BusinessCasesHub } from '../BusinessCasesHub';

const appSrc = readFileSync(resolve(__dirname, '../../../../app/App.tsx'), 'utf-8');
const appRoutes = new Set([...appSrc.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));

describe('business case data', () => {
  it('has ~25 cases with unique ids', () => {
    const ids = BUSINESS_CASES.map((c) => c.id);
    expect(ids.length).toBeGreaterThanOrEqual(25);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('every step route exists in App.tsx', () => {
    expect(caseRoutes().filter((r) => !appRoutes.has(r))).toEqual([]);
  });
  it('every business preset has at least 3 cases', () => {
    for (const key of Object.values(BIZ_SECTIONS).flat()) {
      const n = BUSINESS_CASES.filter((c) => c.industries.includes('*') || c.industries.includes(key)).length;
      expect(n, key).toBeGreaterThanOrEqual(3);
    }
  });
  it('industry tags are known presets', () => {
    const known = new Set(['*', ...Object.values(BIZ_SECTIONS).flat()]);
    for (const c of BUSINESS_CASES) for (const k of c.industries) expect(known.has(k), `${c.id}:${k}`).toBe(true);
  });
});

describe('BusinessCasesHub', () => {
  it('shows business cases for a salon and no construction ones', () => {
    render(<MemoryRouter><BusinessCasesHub /></MemoryRouter>);
    expect(screen.getByText('Salon: booking to invoice')).toBeTruthy();
    expect(screen.getByText('Set up your company')).toBeTruthy();
    expect(screen.queryByText('Hotel guest stay')).toBeNull();
    expect(screen.queryByText('Law firm fee note')).toBeNull();
    expect(document.body.textContent).not.toMatch(/contractor|BOQ|RFI|site diary|tender/i);
  });
  it('opens a case with linked steps', () => {
    render(<MemoryRouter><BusinessCasesHub caseId="quote-to-cash" /></MemoryRouter>);
    expect(screen.getAllByRole('link', { name: /Open/ })[0]?.getAttribute('href')).toBe('/sales/quotes/new');
  });
});
