import { formatClock, formatShortDate } from '@/components/app/format';
import { lagosDate } from '@/lib/lagos-date';

/**
 * The few sums and phrases a practitioner's offers and shifts share. Pure, so each is written down
 * once and tested, and so the cards that show them have nothing to work out.
 */

/** Whole minutes from start to end; never negative. */
export function shiftMinutes(startsAt: string | Date, endsAt: string | Date): number {
  const minutes = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000;
  return Math.max(0, Math.round(minutes));
}

/**
 * What a shift comes to at its hourly rate, in kobo: rate × minutes ÷ 60, rounded once at the end.
 * Rule 3 — money is only ever computed in integer kobo. This is the base figure; the facility's
 * rate card prices night and holiday hours when the shift is invoiced.
 */
export function estimateKobo(hourlyRateKobo: number, minutes: number): number {
  return Math.round((hourlyRateKobo * minutes) / 60);
}

/** "Answer by 21:13 today", "…tomorrow", "…on 21 Oct": the clock first, then the day in words. */
export function answerBy(iso: string, now: Date): string {
  const day = lagosDate(new Date(iso));
  const today = lagosDate(now);
  const tomorrow = lagosDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const when =
    day === today ? 'today' : day === tomorrow ? 'tomorrow' : `on ${formatShortDate(iso)}`;
  return `Answer by ${formatClock(iso)} ${when}`;
}

/**
 * How long is left to answer, and whether that is short enough to say so out loud. `null` once it
 * has passed — a lapsed offer is not waiting for anything.
 */
export function closesIn(
  iso: string,
  now: Date,
  soonWithinHours = 3,
): { text: string; soon: boolean } | null {
  const minutes = Math.floor((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return null;
  const soon = minutes <= soonWithinHours * 60;
  if (minutes < 60) return { text: `closes in ${minutes} minute${minutes === 1 ? '' : 's'}`, soon };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { text: `closes in ${hours} hour${hours === 1 ? '' : 's'}`, soon };
  const days = Math.floor(hours / 24);
  return { text: `closes in ${days} days`, soon };
}
