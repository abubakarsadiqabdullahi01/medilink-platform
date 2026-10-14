import { describe, expect, it } from 'vitest';
import { availabilityFor, type SlotLike, type TimeWindow } from './availability';
import { allDay, tonight, watDate, windowOnDate } from './quick-windows';

/**
 * AVL-02: the screen could build a weekly pattern and nothing else, so "I am
 * free tonight" could not be said. These are the one-off windows its shortcuts
 * and its date form send, worked out in West Africa Time whatever the phone's
 * own clock says.
 */

const iso = (window: TimeWindow) => [window.startsAt.toISOString(), window.endsAt.toISOString()];

function oneOff(window: TimeWindow): SlotLike {
  return {
    kind: 'ONE_OFF',
    dayOfWeek: null,
    startMinute: null,
    endMinute: null,
    effectiveFrom: null,
    effectiveUntil: null,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
  };
}

const shift = (startsAtUtc: string, endsAtUtc: string): TimeWindow => ({
  startsAt: new Date(startsAtUtc),
  endsAt: new Date(endsAtUtc),
});

describe('a date in West Africa Time', () => {
  it('is the Lagos calendar day, not the UTC one', () => {
    expect(watDate(new Date('2026-10-13T23:30:00Z'))).toBe('2026-10-14');
    expect(watDate(new Date('2026-10-14T22:59:00Z'))).toBe('2026-10-14');
    expect(watDate(new Date('2026-10-14T23:00:00Z'))).toBe('2026-10-15');
  });
});

describe('a window on a chosen date', () => {
  it('runs midnight to midnight for all day', () => {
    expect(iso(windowOnDate('2026-10-14', 'all_day'))).toEqual([
      '2026-10-13T23:00:00.000Z',
      '2026-10-14T23:00:00.000Z',
    ]);
  });

  it('is the hours given, on that day', () => {
    expect(iso(windowOnDate('2026-10-14', { from: '08:00', to: '16:00' }))).toEqual([
      '2026-10-14T07:00:00.000Z',
      '2026-10-14T15:00:00.000Z',
    ]);
  });

  it('runs into the next morning when it ends at or before it starts, as a night does', () => {
    expect(iso(windowOnDate('2026-10-14', { from: '20:00', to: '08:00' }))).toEqual([
      '2026-10-14T19:00:00.000Z',
      '2026-10-15T07:00:00.000Z',
    ]);
  });

  it('takes midnight as the end of the day, not the start of it', () => {
    expect(iso(windowOnDate('2026-10-14', { from: '18:00', to: '00:00' }))).toEqual([
      '2026-10-14T17:00:00.000Z',
      '2026-10-14T23:00:00.000Z',
    ]);
  });

  it('refuses hours with no length, which are nearly always a slip', () => {
    expect(() => windowOnDate('2026-10-14', { from: '08:00', to: '08:00' })).toThrow(/length/i);
  });

  it('refuses a date or a time that is not one', () => {
    expect(() => windowOnDate('14/10/2026', 'all_day')).toThrow();
    expect(() => windowOnDate('2026-13-40', 'all_day')).toThrow();
    expect(() => windowOnDate('2026-10-14', { from: '8am', to: '16:00' })).toThrow();
    expect(() => windowOnDate('2026-10-14', { from: '25:00', to: '16:00' })).toThrow();
  });
});

describe('tonight', () => {
  const expected = ['2026-10-14T18:00:00.000Z', '2026-10-15T07:00:00.000Z'];

  it('is this evening to tomorrow morning, whatever time it is by day', () => {
    expect(iso(tonight(new Date('2026-10-14T13:00:00Z')))).toEqual(expected);
  });

  it('is still the same night late in the evening', () => {
    expect(iso(tonight(new Date('2026-10-14T22:30:00Z')))).toEqual(expected);
  });

  it('is the night that is already under way after midnight', () => {
    // 03:00 in Lagos on the 15th: somebody asking now means the rest of this night.
    expect(iso(tonight(new Date('2026-10-15T02:00:00Z')))).toEqual(expected);
  });

  it('turns to the coming night by morning', () => {
    expect(iso(tonight(new Date('2026-10-15T06:00:00Z')))).toEqual([
      '2026-10-15T18:00:00.000Z',
      '2026-10-16T07:00:00.000Z',
    ]);
  });

  it('covers the usual night shifts, and not one that starts earlier', () => {
    const slots = [oneOff(tonight(new Date('2026-10-14T13:00:00Z')))];

    expect(availabilityFor(slots, [], shift('2026-10-14T19:00:00Z', '2026-10-15T07:00:00Z')).available).toBe(true);
    expect(availabilityFor(slots, [], shift('2026-10-14T18:00:00Z', '2026-10-15T06:00:00Z')).available).toBe(true);
    expect(availabilityFor(slots, [], shift('2026-10-14T16:00:00Z', '2026-10-15T04:00:00Z')).available).toBe(false);
  });
});

describe('all day', () => {
  it('is the Lagos day it is now, even when UTC is still on the day before', () => {
    // 00:30 in Lagos on the 14th is 23:30 UTC on the 13th.
    expect(iso(allDay(new Date('2026-10-13T23:30:00Z')))).toEqual([
      '2026-10-13T23:00:00.000Z',
      '2026-10-14T23:00:00.000Z',
    ]);
  });

  it('can be a day ahead', () => {
    expect(iso(allDay(new Date('2026-10-14T10:00:00Z'), 1))).toEqual([
      '2026-10-14T23:00:00.000Z',
      '2026-10-15T23:00:00.000Z',
    ]);
  });

  it('leaves no gap at midnight, so two days in a row cover a night that crosses it', () => {
    const now = new Date('2026-10-14T10:00:00Z');
    const slots = [oneOff(allDay(now)), oneOff(allDay(now, 1))];

    expect(availabilityFor(slots, [], shift('2026-10-14T19:00:00Z', '2026-10-15T07:00:00Z')).available).toBe(true);
  });
});
