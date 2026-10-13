/**
 * Times as people in Nigeria read them: West Africa Time, UTC+1 all year, no
 * daylight saving.
 *
 * The product's screens already show Lagos time; text messages were built from
 * `toISOString()` and said "08:00 UTC" for a shift that starts at nine o'clock
 * on the ward clock, so a practitioner reading the message arrived an hour
 * early. Anything that puts a time in a message, an email or a log meant for a
 * person goes through here.
 */
const ZONE = 'Africa/Lagos';

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const clockFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE });

/** "Wed 15 Oct" */
export function watDay(at: Date): string {
  return dayFormat.format(at).replace(',', '');
}

/** "09:00" */
export function watClock(at: Date): string {
  return clockFormat.format(at);
}

/** "Wed 15 Oct, 09:00 WAT" for a single moment. */
export function watMoment(at: Date): string {
  return `${watDay(at)}, ${watClock(at)} WAT`;
}

/**
 * "Wed 15 Oct, 09:00 to 17:00 WAT" — and, for a shift that runs through the
 * night, "Wed 15 Oct, 20:00 to Thu 16 Oct, 08:00 WAT", so nobody has to work
 * out which morning the end falls on.
 */
export function watWindow(start: Date, end: Date): string {
  const sameDay = dateKey.format(start) === dateKey.format(end);
  return sameDay
    ? `${watDay(start)}, ${watClock(start)} to ${watClock(end)} WAT`
    : `${watDay(start)}, ${watClock(start)} to ${watDay(end)}, ${watClock(end)} WAT`;
}
