import { NIGHT_ENDS_MINUTE, NIGHT_STARTS_MINUTE } from '@/modules/timesheets/domain/hours';
import { WAT_OFFSET_MINUTES } from '@/modules/availability/domain/availability';

/**
 * Whether a shift is a day shift or a night shift, from its own times (UXF-06).
 *
 * The facility used to say, with a picker, and the pay floor differs by shift type, so
 * a night shift labelled a day shift was held to the lower floor. The type is a fact
 * about the hours, so it is worked out from them: by where most of them fall, using the
 * same night window the timesheet prices (20:00 to 06:00 WAT).
 *
 * Half or more at night is a night shift. A shift that straddles the line is rare, and
 * when it does the higher floor is the safer side to err on.
 */
export function deriveShiftType(startsAt: Date, endsAt: Date): 'DAY' | 'NIGHT' {
  const MINUTE = 60_000;
  let total = 0;
  let night = 0;

  // A shift is at most a day (MAX_SHIFT_HOURS) and is refused beyond that elsewhere; this
  // is called with whatever arrives at the boundary first, so it never walks further than
  // two days however absurd the end time is.
  const to = Math.min(endsAt.getTime(), startsAt.getTime() + 48 * 60 * MINUTE);

  for (let at = startsAt.getTime(); at < to; at += MINUTE) {
    const shifted = new Date(at + WAT_OFFSET_MINUTES * MINUTE);
    const minuteOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
    total += 1;
    if (minuteOfDay >= NIGHT_STARTS_MINUTE || minuteOfDay < NIGHT_ENDS_MINUTE) night += 1;
  }

  return total > 0 && night * 2 >= total ? 'NIGHT' : 'DAY';
}
