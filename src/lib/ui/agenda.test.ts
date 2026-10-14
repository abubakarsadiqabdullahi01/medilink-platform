import { describe, expect, it } from 'vitest';
import { agenda, dayHeading, lagosDayKey } from './agenda';

/**
 * Lagos is one hour ahead of UTC all year (Nigeria keeps no daylight saving), so every case here
 * is written in UTC and the expected day is what a ward in Lagos would call it. None of it depends
 * on the machine's own time zone.
 */
const shift = (id: string, startsAt: string, endsAt: string) => ({ id, startsAt, endsAt });

// Wednesday 14 October 2026, 09:00 in Lagos.
const NOW = new Date('2026-10-14T08:00:00.000Z');

describe('which day a moment is, in Lagos', () => {
  it.each([
    ['2026-10-14T22:59:59.000Z', '2026-10-14'],
    ['2026-10-14T23:00:00.000Z', '2026-10-15'], // midnight in Lagos
    ['2026-10-14T00:00:00.000Z', '2026-10-14'],
    ['2026-12-31T23:30:00.000Z', '2027-01-01'], // across a year
  ])('puts %s on %s', (iso, day) => {
    expect(lagosDayKey(new Date(iso))).toBe(day);
  });
});

describe('what a day is called', () => {
  it('calls today and tomorrow that, and any other day by its weekday, date and month', () => {
    expect(dayHeading('2026-10-14', NOW)).toBe('Today');
    expect(dayHeading('2026-10-15', NOW)).toBe('Tomorrow');
    expect(dayHeading('2026-10-16', NOW)).toBe('Fri 16 Oct');
    expect(dayHeading('2027-01-01', NOW)).toBe('Fri 1 Jan');
  });
});

describe('the agenda', () => {
  const items = [
    shift('late', '2026-10-21T07:00:00.000Z', '2026-10-21T15:00:00.000Z'),
    shift('tomorrow', '2026-10-15T07:00:00.000Z', '2026-10-15T15:00:00.000Z'),
    shift('this-morning', '2026-10-14T07:00:00.000Z', '2026-10-14T15:00:00.000Z'),
    shift('tonight', '2026-10-14T19:00:00.000Z', '2026-10-15T07:00:00.000Z'),
    shift('over', '2026-10-13T07:00:00.000Z', '2026-10-13T15:00:00.000Z'),
  ];

  it('groups by the day each shift starts, soonest first, with the days named', () => {
    const { groups } = agenda(items, NOW, 'all');

    expect(groups.map((group) => [group.heading, group.items.map((i) => i.id)])).toEqual([
      ['Earlier, still confirmed', ['over']],
      ['Today', ['this-morning', 'tonight']],
      ['Tomorrow', ['tomorrow']],
      ['Wed 21 Oct', ['late']],
    ]);
  });

  it('lists a shift that runs past midnight under the day it starts, not the day it ends', () => {
    const { groups } = agenda([items[3]!], NOW, 'all');

    expect(groups.map((group) => group.heading)).toEqual(['Today']);
  });

  it('does not hide a shift that has ended and is still open: it is the one that needs attention', () => {
    const { groups } = agenda([items[4]!], NOW, 'today');

    expect(groups.map((group) => group.heading)).toEqual(['Earlier, still confirmed']);
  });

  it('shows only today for "today", including a shift in progress that began yesterday', () => {
    const overnight = shift('overnight', '2026-10-13T19:00:00.000Z', '2026-10-14T09:00:00.000Z');

    const { groups, later } = agenda([...items, overnight], NOW, 'today');

    expect(groups.flatMap((group) => group.items.map((i) => i.id))).toEqual(['over', 'overnight', 'this-morning', 'tonight']);
    expect(later).toBe(2); // tomorrow, and the 21st
  });

  it('counts the seventh day, today and the six after it, as inside the week', () => {
    const sixthDay = shift('sixth', '2026-10-20T07:00:00.000Z', '2026-10-20T15:00:00.000Z');
    const seventh = shift('seventh', '2026-10-21T07:00:00.000Z', '2026-10-21T15:00:00.000Z');

    const { groups, later } = agenda([sixthDay, seventh], NOW, 'week');

    expect(groups.flatMap((group) => group.items.map((i) => i.id))).toEqual(['sixth']);
    expect(later).toBe(1);
  });

  it('shows the next seven days for "week", and counts what is beyond it', () => {
    const { groups, later } = agenda(items, NOW, 'week');

    expect(groups.flatMap((group) => group.items.map((i) => i.id))).toEqual(['over', 'this-morning', 'tonight', 'tomorrow']);
    expect(later).toBe(1);
  });

  it('counts nothing as later when everything is shown', () => {
    expect(agenda(items, NOW, 'all').later).toBe(0);
  });

  it('is empty, without failing, when there are no shifts', () => {
    expect(agenda([], NOW, 'week')).toEqual({ groups: [], later: 0 });
  });

  it('leaves the shifts it was given as they were', () => {
    const copy = structuredClone(items);

    agenda(items, NOW, 'all');

    expect(items).toEqual(copy);
  });
});
