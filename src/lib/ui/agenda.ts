/**
 * Confirmed shifts as an agenda: by day, soonest first, in Lagos time (M08-01).
 *
 * Lagos is one hour ahead of UTC all year and Nigeria keeps no daylight saving, so a day is worked out
 * with that fixed offset rather than the browser's own zone: a ward and a nurse who are both in Lagos
 * see the same shift on the same day whatever their phones are set to.
 *
 * Pure, so the rules are tested without a screen.
 */

export type AgendaRange = 'today' | 'week' | 'all';

export interface AgendaItem {
  startsAt: string;
  endsAt: string;
}

export interface AgendaGroup<T> {
  key: string;
  heading: string;
  items: T[];
}

const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Today and the six days after it. */
const WEEK_DAYS = 7;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM-DD`, the Lagos date of an instant. */
export function lagosDayKey(instant: Date): string {
  return new Date(instant.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

const addDays = (key: string, days: number): string =>
  new Date(new Date(`${key}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);

/** "Today", "Tomorrow", or "Fri 16 Oct": built by hand, so no locale or ICU version can change it. */
export function dayHeading(key: string, now: Date): string {
  const today = lagosDayKey(now);
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  const date = new Date(`${key}T00:00:00.000Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

const EARLIER = 'earlier';

/**
 * Shifts grouped by the day each starts, soonest first.
 *
 * - A shift that runs past midnight is listed under the day it starts.
 * - One already under way is listed under today, even if it began yesterday evening.
 * - One that has ended and is still confirmed goes first, under its own heading, in every range:
 *   it is the one that needs somebody's attention, not one to scroll past.
 * - `later` is how many upcoming shifts the range left out, so the screen can say so.
 */
export function agenda<T extends AgendaItem>(
  items: T[],
  now: Date,
  range: AgendaRange,
): { groups: AgendaGroup<T>[]; later: number } {
  const today = lagosDayKey(now);
  const lastDay = addDays(today, WEEK_DAYS - 1);
  const sorted = [...items].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  const byKey = new Map<string, T[]>();
  let later = 0;

  for (const item of sorted) {
    const start = new Date(item.startsAt);
    const ended = new Date(item.endsAt).getTime() <= now.getTime();
    const underWay = !ended && start.getTime() <= now.getTime();
    const startDay = lagosDayKey(start);

    let key: string;
    if (ended) key = EARLIER;
    else if (underWay && startDay < today) key = today;
    else key = startDay;

    if (key !== EARLIER) {
      const inRange = range === 'all' || (range === 'today' ? key === today : key <= lastDay);
      if (!inRange) {
        later += 1;
        continue;
      }
    }

    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }

  const keys = [...byKey.keys()].sort((a, b) => (a === EARLIER ? -1 : b === EARLIER ? 1 : a.localeCompare(b)));
  return {
    groups: keys.map((key) => ({
      key,
      heading: key === EARLIER ? 'Earlier, still confirmed' : dayHeading(key, now),
      items: byKey.get(key)!,
    })),
    later,
  };
}
