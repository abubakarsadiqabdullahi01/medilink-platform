/**
 * The one-off windows the availability screen's shortcuts and date form send.
 * Pure, no database, and safe to import from the browser.
 *
 * Everything is worked out in West Africa Time, as recurring slots already are
 * (`WAT_OFFSET_MINUTES`), and not in whatever zone the phone is set to: a
 * practitioner who says "tonight" means tonight in Nigeria, and a phone on
 * roaming or with the wrong zone must not move their evening.
 */
import { lagosDate, startOfLagosDay } from '@/lib/lagos-date';
import { WAT_OFFSET_MINUTES, type TimeWindow } from './availability';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** When a night shift usually begins and ends, and the span "tonight" offers. */
const TONIGHT_FROM_HOUR = 19;
const TONIGHT_UNTIL_HOUR = 8;
/** Before this the small hours still belong to the night before. */
const NIGHT_ENDS_HOUR = 6;

/** The Lagos calendar day containing this instant, as `YYYY-MM-DD`. */
export const watDate = lagosDate;

function minuteOfDay(clock: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(clock);
  const hours = match ? Number(match[1]) : NaN;
  const minutes = match ? Number(match[2]) : NaN;
  if (!match || hours > 23 || minutes > 59) throw new Error(`"${clock}" is not a time written 24-hour, like 08:00.`);
  return hours * 60 + minutes;
}

/**
 * Hours on one date, or all of it.
 *
 * An end at or before the start runs into the next morning, which is how a night
 * is said ("20:00 to 08:00") and how recurring slots already read. An end of
 * exactly the same time is a window with no length and is refused: it is nearly
 * always a slip, and "all day" has its own way of being said.
 */
export function windowOnDate(
  date: string,
  hours: 'all_day' | { from: string; to: string },
): TimeWindow {
  const start = startOfLagosDay(date);
  if (hours === 'all_day') return { startsAt: start, endsAt: new Date(start.getTime() + DAY) };

  const from = minuteOfDay(hours.from);
  const to = minuteOfDay(hours.to);
  if (from === to) throw new Error('Those hours have no length. For the whole day, choose all day.');

  const length = to > from ? to - from : 24 * 60 - from + to;
  const startsAt = new Date(start.getTime() + from * MINUTE);
  return { startsAt, endsAt: new Date(startsAt.getTime() + length * MINUTE) };
}

/**
 * This evening to tomorrow morning, or the rest of the night if it is already
 * under way: asked at 03:00 it means the night that began yesterday, not the one
 * sixteen hours away.
 */
export function tonight(now: Date): TimeWindow {
  const shifted = new Date(now.getTime() + WAT_OFFSET_MINUTES * MINUTE);
  const today = watDate(now);
  const evening =
    shifted.getUTCHours() < NIGHT_ENDS_HOUR
      ? startOfLagosDay(today).getTime() - DAY + TONIGHT_FROM_HOUR * 60 * MINUTE
      : startOfLagosDay(today).getTime() + TONIGHT_FROM_HOUR * 60 * MINUTE;
  const startsAt = new Date(evening);
  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + (24 - TONIGHT_FROM_HOUR + TONIGHT_UNTIL_HOUR) * 60 * MINUTE),
  };
}

/** All of today, or of a day ahead, in Lagos. */
export function allDay(now: Date, daysAhead = 0): TimeWindow {
  const start = new Date(startOfLagosDay(watDate(now)).getTime() + daysAhead * DAY);
  return { startsAt: start, endsAt: new Date(start.getTime() + DAY) };
}
