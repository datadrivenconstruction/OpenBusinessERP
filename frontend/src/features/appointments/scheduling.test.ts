import { describe, expect, it } from 'vitest';
import type { Booking, Service } from './api';
import {
  bookingKpis,
  copyDay,
  dateRange,
  groupByDay,
  icsEvent,
  invalidDays,
  layoutLanes,
  mailtoHref,
  partOfDay,
  serviceErrors,
  servicePatch,
  weeklyMinutes,
} from './scheduling';
import { filterBookings } from './components/BookingList';
import { visibleRange } from './components/CalendarView';
import { EMPTY_SERVICE, serviceBase } from './modals/ServiceFormModal';

const bk = (id: string, start: string, end: string, extra: Partial<Booking> = {}): Booking => ({
  id, service_id: 's1', resource_id: 'r1', contact_id: null, client_name: id, client_email: `${id}@x.io`, client_phone: '',
  start_at: start, end_at: end, status: 'confirmed', source: 'staff', notes: '', consent_at: null, series_id: null, invoice_id: null, ...extra,
});
const svc: Service = { ...EMPTY_SERVICE, id: 's1', name: 'Cut', price: '50', currency: 'EUR' };

describe('layoutLanes', () => {
  it('puts overlapping bookings side by side and resets lanes after a gap', () => {
    const m = layoutLanes([
      bk('a', '2030-01-07T09:00:00', '2030-01-07T10:00:00'),
      bk('b', '2030-01-07T09:30:00', '2030-01-07T10:30:00'),
      bk('c', '2030-01-07T10:00:00', '2030-01-07T11:00:00'),
      bk('d', '2030-01-07T12:00:00', '2030-01-07T13:00:00'),
    ]);
    expect(m.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(m.get('b')).toEqual({ lane: 1, lanes: 2 });
    expect(m.get('c')).toEqual({ lane: 0, lanes: 2 });
    expect(m.get('d')).toEqual({ lane: 0, lanes: 1 });
  });
});

describe('bookingKpis', () => {
  it('counts today, requests, no-show rate and unbilled work', () => {
    const now = new Date(2030, 0, 7, 8, 0);
    const k = bookingKpis([
      bk('a', '2030-01-07T09:00:00', '2030-01-07T10:00:00'),
      bk('b', '2030-01-08T09:00:00', '2030-01-08T10:00:00', { status: 'requested' }),
      bk('c', '2030-01-01T09:00:00', '2030-01-01T10:00:00', { status: 'completed' }),
      bk('d', '2030-01-02T09:00:00', '2030-01-02T10:00:00', { status: 'no_show' }),
      bk('e', '2030-01-07T11:00:00', '2030-01-07T12:00:00', { status: 'cancelled' }),
    ], [svc], now);
    expect(k.today).toBe(1);
    expect(k.upcoming).toBe(2);
    expect(k.requested).toBe(1);
    expect(k.noShowRate).toBe(0.5);
    expect(k.bookedValue).toBe(150);
    expect(k.toInvoice).toBe(1);
    expect(k.toInvoiceValue).toBe(50);
  });
});

describe('weekly rules', () => {
  const rows = [
    { weekday: 0, start_min: 540, end_min: 1020, kind: 'work' as const },
    { weekday: 0, start_min: 780, end_min: 840, kind: 'break' as const },
    { weekday: 2, start_min: 600, end_min: 700, kind: 'work' as const },
  ];
  it('copies one day to other weekdays, replacing their rules', () => {
    const out = copyDay(rows, 0, [0, 1, 2]);
    expect(out.filter((r) => r.weekday === 2)).toHaveLength(2);
    expect(out.filter((r) => r.weekday === 1).map((r) => r.kind)).toEqual(['work', 'break']);
  });
  it('flags reversed and overlapping ranges', () => {
    expect(invalidDays(rows)).toEqual([]);
    expect(invalidDays([...rows, { weekday: 0, start_min: 900, end_min: 1100, kind: 'work' }])).toEqual([0]);
    expect(invalidDays([{ weekday: 3, start_min: 600, end_min: 500, kind: 'work' }])).toEqual([3]);
  });
  it('sums bookable minutes', () => {
    expect(weeklyMinutes(rows)).toBe(480 - 60 + 100);
  });
  it('expands date ranges', () => {
    expect(dateRange('2030-01-30', '2030-02-02')).toEqual(['2030-01-30', '2030-01-31', '2030-02-01', '2030-02-02']);
    expect(dateRange('2030-01-30', '')).toEqual(['2030-01-30']);
    expect(dateRange('', '')).toEqual([]);
  });
});

describe('service form', () => {
  it('sends only changed fields', () => {
    const base = serviceBase(svc);
    expect(servicePatch({ ...base, price: '60', resource_ids: ['r1'] }, base)).toEqual({ price: '60', resource_ids: ['r1'] });
    expect(servicePatch(base, base)).toEqual({});
  });
  it('validates name, duration and currency', () => {
    expect(serviceErrors({ ...EMPTY_SERVICE, name: 'x' })).toEqual([]);
    expect(serviceErrors({ ...EMPTY_SERVICE, name: ' ', duration_min: 0, currency: 'eu' }).map(([k]) => k)).toEqual([
      'appointments.err_name', 'appointments.err_duration', 'appointments.err_currency',
    ]);
  });
});

describe('misc helpers', () => {
  it('groups slots by day and part of day', () => {
    expect(groupByDay(['2030-01-07T09:00:00', '2030-01-07T15:00:00', '2030-01-08T18:00:00'])).toEqual([
      ['2030-01-07', ['2030-01-07T09:00:00', '2030-01-07T15:00:00']],
      ['2030-01-08', ['2030-01-08T18:00:00']],
    ]);
    expect([partOfDay('2030-01-07T09:00:00'), partOfDay('2030-01-07T13:00:00'), partOfDay('2030-01-07T18:30:00')]).toEqual(['morning', 'afternoon', 'evening']);
  });
  it('builds a floating-time calendar event and a mailto link', () => {
    const ics = icsEvent({ uid: 'u1', title: 'Cut, wash', start: '2030-01-07T09:00:00', end: '2030-01-07T10:00:00' });
    expect(ics).toContain('DTSTART:20300107T090000');
    expect(ics).toContain('SUMMARY:Cut\\, wash');
    expect(mailtoHref('a@b.c', 'Hi there', 'L1\nL2')).toBe('mailto:a%40b.c?subject=Hi%20there&body=L1%0AL2');
  });
  it('filters the list by status, unbilled work and search', () => {
    const rows = [bk('anna', '2030-01-07T09:00:00', '2030-01-07T10:00:00', { status: 'completed' }), bk('bob', '2030-01-07T11:00:00', '2030-01-07T12:00:00')];
    expect(filterBookings(rows, 'to_invoice', '').map((b) => b.id)).toEqual(['anna']);
    expect(filterBookings(rows, '', 'BOB').map((b) => b.id)).toEqual(['bob']);
    expect(filterBookings(rows, 'confirmed', '').map((b) => b.id)).toEqual(['bob']);
  });
  it('widens the calendar range for early or late bookings', () => {
    expect(visibleRange([])).toEqual([420, 1260]);
    expect(visibleRange([bk('x', '2030-01-07T06:30:00', '2030-01-07T22:15:00')])).toEqual([360, 1380]);
  });
});
