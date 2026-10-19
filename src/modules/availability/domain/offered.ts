import { mergeWindows, slotWindows, type SlotLike, type TimeWindow } from './availability';

/**
 * What a practitioner offers, in one reading (M05-02). Pure, no database.
 *
 *   offered  =  (weekly patterns in force  ∪  dated free windows)  −  time away
 *
 * Time away is the most specific thing somebody can say, and it always wins: a shift that touches
 * it is never offered, however much else they have said. That includes a free window they added
 * inside it. The safe mistake is a shift not offered to somebody who would have taken it; the
 * unsafe one is a shift offered to somebody who said they were away. The screens say so wherever
 * somebody has put a free window inside their time away, so it is never a silent disagreement.
 *
 * Everything that reads availability is answered from here: the matcher's verdict, whether the
 * practitioner will be offered anything at all, and what the availability screen says about each
 * thing they have entered. Three readings of one diary that can disagree were the problem; this is
 * the one.
 */

const DAY = 24 * 60 * 60 * 1000;

/**
 * How far ahead "can they be offered anything" looks. A shift is rarely published further out,
 * and a practitioner whose offers are all in time away for longer than this is, for every
 * practical purpose, not available.
 */
export const LOOKAHEAD_DAYS = 90;

const ms = (date: Date) => date.getTime();

/** The windows with the time away cut out of them: merged, in order, none of them empty. */
export function subtractWindows(windows: TimeWindow[], away: TimeWindow[]): TimeWindow[] {
  // A period of no length takes nothing away, and must not split a window in two.
  const cuts = mergeWindows(away.filter((period) => ms(period.endsAt) > ms(period.startsAt)));
  const result: TimeWindow[] = [];

  for (const window of mergeWindows(windows)) {
    let start = ms(window.startsAt);
    const end = ms(window.endsAt);

    for (const cut of cuts) {
      const cutStart = ms(cut.startsAt);
      const cutEnd = ms(cut.endsAt);
      if (cutEnd <= start) continue;
      if (cutStart >= end) break;
      if (cutStart > start) result.push({ startsAt: new Date(start), endsAt: new Date(cutStart) });
      start = Math.max(start, cutEnd);
      if (start >= end) break;
    }

    if (start < end) result.push({ startsAt: new Date(start), endsAt: window.endsAt });
  }

  return result;
}

/** What is offered inside `range`, once time away has been taken out: merged, in order. */
export function offeredWindows(slots: SlotLike[], away: TimeWindow[], range: TimeWindow): TimeWindow[] {
  if (ms(range.endsAt) <= ms(range.startsAt)) return [];

  const inRange = mergeWindows(slots.flatMap((slot) => slotWindows(slot, range))).flatMap((window) => {
    const startsAt = new Date(Math.max(ms(window.startsAt), ms(range.startsAt)));
    const endsAt = new Date(Math.min(ms(window.endsAt), ms(range.endsAt)));
    return ms(startsAt) < ms(endsAt) ? [{ startsAt, endsAt }] : [];
  });

  return subtractWindows(inRange, away);
}

/**
 * The first stretch the matcher could offer from `now` on, starting no earlier than `now`; null when
 * there is none within the next `LOOKAHEAD_DAYS`.
 */
export function nextOffered(slots: SlotLike[], away: TimeWindow[], now: Date): TimeWindow | null {
  const range = { startsAt: now, endsAt: new Date(ms(now) + LOOKAHEAD_DAYS * DAY) };
  return offeredWindows(slots, away, range)[0] ?? null;
}

/**
 * Where one thing somebody said stands today, so the screen can say when it is doing nothing.
 *
 *   open          in force, and some of it is not away
 *   part_away     a dated free window that time away cuts into
 *   all_away      nothing of it survives time away: it is entered, and does nothing
 *   starts_later  a pattern that is not yet in force
 *   finished      a dated window that is over, or a pattern that has ended
 */
export type SlotStanding = 'open' | 'part_away' | 'all_away' | 'starts_later' | 'finished';

export function slotStanding(slot: SlotLike, away: TimeWindow[], now: Date): SlotStanding {
  if (slot.kind === 'RECURRING_WEEKLY' && slot.effectiveFrom && ms(slot.effectiveFrom) > ms(now)) {
    return 'starts_later';
  }

  const range = { startsAt: now, endsAt: new Date(ms(now) + LOOKAHEAD_DAYS * DAY) };
  // What is still to come of it, from now.
  const remaining = slotWindows(slot, range)
    .filter((window) => ms(window.endsAt) > ms(now))
    .map((window) => ({
      startsAt: new Date(Math.max(ms(window.startsAt), ms(now))),
      endsAt: window.endsAt,
    }));
  if (remaining.length === 0) return 'finished';

  const surviving = subtractWindows(remaining, away);
  if (surviving.length === 0) return 'all_away';

  if (slot.kind === 'ONE_OFF') {
    const length = (windows: TimeWindow[]) => windows.reduce((sum, w) => sum + ms(w.endsAt) - ms(w.startsAt), 0);
    if (length(surviving) < length(remaining)) return 'part_away';
  }
  return 'open';
}
