// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { DateField, datePatternFor, formatIsoDate, parseDateText } from './DateField';

describe('datePatternFor', () => {
  it('follows the app language, not the OS', () => {
    expect(datePatternFor('de-DE')).toEqual({ order: ['day', 'month', 'year'], sep: '.' });
    expect(datePatternFor('en-US')).toEqual({ order: ['month', 'day', 'year'], sep: '/' });
    expect(datePatternFor('en-US', 'YYYY-MM-DD')).toEqual({ order: ['year', 'month', 'day'], sep: '-' });
  });
});

describe('parse/format', () => {
  const de = datePatternFor('de-DE');
  const us = datePatternFor('en-US');
  const now = new Date(2026, 5, 1);
  it('round-trips ISO through the locale pattern', () => {
    expect(formatIsoDate('2026-03-07', de)).toBe('07.03.2026');
    expect(formatIsoDate('2026-03-07', us)).toBe('03/07/2026');
  });
  it('parses typed text in locale order', () => {
    expect(parseDateText('7.3.2026', de, now)).toBe('2026-03-07');
    expect(parseDateText('3/7/26', us, now)).toBe('2026-03-07');
    expect(parseDateText('07032026', de, now)).toBe('2026-03-07');
    expect(parseDateText('7.3', de, now)).toBe('2026-03-07');
    expect(parseDateText('2026-03-07', us, now)).toBe('2026-03-07');
    expect(parseDateText('', de, now)).toBe('');
  });
  it('rejects impossible dates', () => {
    expect(parseDateText('31.02.2026', de, now)).toBeNull();
    expect(parseDateText('abc', de, now)).toBeNull();
  });
});

function Harness({ onChange, min }: { onChange: (v: string) => void; min?: string }) {
  const [v, setV] = useState('2026-03-07');
  return (
    <DateField
      aria-label="date"
      value={v}
      min={min}
      onChange={(e) => {
        setV(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

describe('DateField', () => {
  it('commits typed text on Enter as ISO and flags invalid input', () => {
    const spy = vi.fn();
    render(<Harness onChange={spy} />);
    const input = screen.getByLabelText('date') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-04-09' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spy).toHaveBeenLastCalledWith('2026-04-09');
    fireEvent.change(input, { target: { value: '99.99.9999' } });
    fireEvent.blur(input);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rejects a date below min', () => {
    const spy = vi.fn();
    render(<Harness onChange={spy} min="2026-03-01" />);
    const input = screen.getByLabelText('date');
    fireEvent.change(input, { target: { value: '2026-02-01' } });
    fireEvent.blur(input);
    expect(spy).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('opens a calendar with Alt+ArrowDown, picks with the keyboard, closes on Escape', () => {
    const spy = vi.fn();
    render(<Harness onChange={spy} />);
    const input = screen.getByLabelText('date');
    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    fireEvent.click(document.activeElement as HTMLElement);
    expect(spy).toHaveBeenLastCalledWith('2026-03-08');
    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
