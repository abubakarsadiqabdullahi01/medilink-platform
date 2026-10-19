/**
 * Availability: pure, no database.
 *
 * The question the matcher asks is narrow — "does this practitioner offer the
 * *whole* of this shift, with none of it blocked?" — and partial availability
 * is a no. Half a night shift is not a night shift.
 */

/**
 * West Africa Time. Nigeria is UTC+1 all year with no daylight saving, which
 * is why a fixed offset is honest here and a timezone library would be
 * ceremony. Recurring slots are stored as minutes since midnight *in this
 * offset*, because that is how a practitioner states them.
 */
export const WAT_OFFSET_MINUTES = 60;

const MINUTE = 60 * 1000;
const DAY_MINUTES = 24 * 60;

export interface TimeWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface SlotLike {
  kind: 'RECURRING_WEEKLY' | 'ONE_OFF';
  dayOfWeek: number | null;
  startMinute: number | null;
  endMinute: number | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

export function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

/** The UTC instant of midnight WAT on the WAT-calendar day containing `at`. */
function watDayStart(at: Date): Date {
  const shifted = new Date(at.getTime() + WAT_OFFSET_MINUTES * MINUTE);
  const midnightAsUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return new Date(midnightAsUtc - WAT_OFFSET_MINUTES * MINUTE);
}

function watDayOfWeek(dayStart: Date): number {
  return new Date(dayStart.getTime() + WAT_OFFSET_MINUTES * MINUTE).getUTCDay();
}

/**
 * Turns a recurring rule into the concrete windows it produces around a
 * shift. Starts a day early, because a slot that runs past midnight on Monday
 * covers the small hours of Tuesday — which is exactly when night shifts are.
 */
function expandRecurring(slot: SlotLike, window: TimeWindow): TimeWindow[] {
  if (slot.dayOfWeek === null || slot.startMinute === null || slot.endMinute === null) return [];

  const windows: TimeWindow[] = [];
  const firstDay = watDayStart(new Date(window.startsAt.getTime() - DAY_MINUTES * MINUTE));
  const lastDay = watDayStart(window.endsAt);

  for (
    let dayStart = firstDay;
    dayStart.getTime() <= lastDay.getTime();
    dayStart = new Date(dayStart.getTime() + DAY_MINUTES * MINUTE)
  ) {
    if (watDayOfWeek(dayStart) !== slot.dayOfWeek) continue;

    const startsAt = new Date(dayStart.getTime() + slot.startMinute * MINUTE);
    // An end at or before the start means it runs into the following day.
    const lengthMinutes =
      slot.endMinute > slot.startMinute
        ? slot.endMinute - slot.startMinute
        : DAY_MINUTES - slot.startMinute + slot.endMinute;
    const endsAt = new Date(startsAt.getTime() + lengthMinutes * MINUTE);

    // An occurrence belongs to the day it starts, and the pattern's bounds are compared with when
    // it starts: in force from `effectiveFrom` (inclusive) until `effectiveUntil` (exclusive). A
    // night that begins the evening before a pattern does is not offered, though it runs into the
    // morning the pattern is in force; the last night of a pattern that ends at midnight is offered
    // whole. Comparing the end against `effectiveFrom`, as this once did, offered that first night.
    if (slot.effectiveFrom && startsAt.getTime() < slot.effectiveFrom.getTime()) continue;
    if (slot.effectiveUntil && startsAt.getTime() >= slot.effectiveUntil.getTime()) continue;

    windows.push({ startsAt, endsAt });
  }

  return windows;
}

export function slotWindows(slot: SlotLike, around: TimeWindow): TimeWindow[] {
  if (slot.kind === 'ONE_OFF') {
    if (!slot.startsAt || !slot.endsAt) return [];
    return [{ startsAt: slot.startsAt, endsAt: slot.endsAt }];
  }
  return expandRecurring(slot, around);
}

/**
 * Merges overlapping and touching windows. Touching matters: two adjacent
 * slots, 08:00–14:00 and 14:00–20:00, cover a 09:00–18:00 shift between them,
 * and a merge that only joined *overlapping* windows would say they do not.
 */
export function mergeWindows(windows: TimeWindow[]): TimeWindow[] {
  const sorted = [...windows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const merged: TimeWindow[] = [];

  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.startsAt.getTime() <= last.endsAt.getTime()) {
      if (window.endsAt.getTime() > last.endsAt.getTime()) last.endsAt = window.endsAt;
      continue;
    }
    merged.push({ startsAt: window.startsAt, endsAt: window.endsAt });
  }

  return merged;
}

export interface AvailabilityVerdict {
  available: boolean;
  /**
   * Why not, in the three ways that mean something to the person asking: they blocked the time,
   * they offered none of it, or they offered part of it. The last is told apart from the second
   * because it is the one a facility can do something about, by shortening or splitting the shift.
   */
  reason: 'available' | 'blocked' | 'not_offered' | 'partly_offered';
}

/**
 * Whether this practitioner offers the whole shift and none of it is blocked.
 *
 * A block is checked first and reported separately, because "I am away that
 * week" and "I do not work Tuesdays" are different answers, and a facility
 * chasing an unfilled shift benefits from knowing which.
 */
export function availabilityFor(
  slots: SlotLike[],
  blocks: TimeWindow[],
  window: TimeWindow,
): AvailabilityVerdict {
  if (window.endsAt.getTime() <= window.startsAt.getTime()) {
    return { available: false, reason: 'not_offered' };
  }

  if (blocks.some((block) => overlaps(block, window))) {
    return { available: false, reason: 'blocked' };
  }

  const offered = mergeWindows(slots.flatMap((slot) => slotWindows(slot, window)));
  const covering = offered.find(
    (candidate) =>
      candidate.startsAt.getTime() <= window.startsAt.getTime() &&
      candidate.endsAt.getTime() >= window.endsAt.getTime(),
  );

  if (covering) return { available: true, reason: 'available' };

  // Some of what they offered falls inside the shift, but no stretch of it covers the whole.
  // Touching is not overlapping: a slot that ends the moment the shift starts offers none of it.
  return offered.some((candidate) => overlaps(candidate, window))
    ? { available: false, reason: 'partly_offered' }
    : { available: false, reason: 'not_offered' };
}

export function coversWindow(
  slots: SlotLike[],
  blocks: TimeWindow[],
  window: TimeWindow,
): boolean {
  return availabilityFor(slots, blocks, window).available;
}
