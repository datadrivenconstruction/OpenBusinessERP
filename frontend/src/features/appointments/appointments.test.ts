import { describe, expect, it } from 'vitest';
import {
  NEXT_STATUS,
  STATUSES,
  embedSnippet,
  hhmmToMin,
  minToHHMM,
  parseLocal,
  placement,
  snap,
  startOfWeek,
  toLocalIso,
} from './api';
import { clientWord } from './clientLabel';

describe('appointments helpers', () => {
  it('converts minutes and HH:MM both ways', () => {
    expect(minToHHMM(545)).toBe('09:05');
    expect(hhmmToMin('17:30')).toBe(1050);
  });

  it('keeps wall-clock times without a zone shift', () => {
    const d = new Date(2030, 0, 7, 9, 15);
    expect(toLocalIso(d)).toBe('2030-01-07T09:15:00');
    expect(parseLocal('2030-01-07T09:15:00').getTime()).toBe(d.getTime());
  });

  it('weeks start on Monday', () => {
    expect(startOfWeek(new Date(2030, 0, 13)).getDate()).toBe(7);
  });

  it('places a booking inside the visible day and snaps to the grid', () => {
    const pos = placement({ start_at: '2030-01-07T09:00:00', end_at: '2030-01-07T10:30:00' }, 420, 1260);
    expect(pos).toEqual({ top: 120, height: 90 });
    expect(snap(52, 15)).toBe(45);
  });

  it('builds an embed snippet that points at the public page', () => {
    expect(embedSnippet('https://erp.example', 'studio-ab12')).toContain('src="https://erp.example/book/studio-ab12"');
  });

  it('every status has a transition entry and closed ones are final', () => {
    for (const s of STATUSES) expect(NEXT_STATUS[s]).toBeDefined();
    expect(NEXT_STATUS.completed).toEqual([]);
    expect(NEXT_STATUS.cancelled).toEqual([]);
  });

  it('names the booked person by industry', () => {
    expect(clientWord('medical_practice')[1]).toBe('Patient');
    expect(clientWord('fitness_studio')[1]).toBe('Member');
    expect(clientWord(null)[1]).toBe('Client');
  });
});
