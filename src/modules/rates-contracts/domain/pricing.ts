/**
 * What a shift costs once the facility's allowances are applied. Pure, no
 * database.
 *
 * Module 11. The timesheet says how many minutes fell in which band; this
 * says what those minutes are worth.
 *
 * **Multipliers are basis points, not floats.** 15000 is 1.5x. Money is
 * integer kobo (rule 3) precisely to avoid the rounding argument, and a float
 * multiplier would reintroduce it one line later.
 *
 * **Every multiplier defaults to 10000 — no premium at all.** The platform
 * does not decide what a night is worth to a hospital in Owerri; a facility
 * that wants to pay more for nights sets it, and until somebody does the
 * figures are exactly what they were before this module existed.
 */

/** 10000 basis points is 1.0x: the rate as agreed, with nothing added. */
export const NO_PREMIUM_BP = 10_000;

/** Sanity bounds. Below par is a rate cut by another name; 5x is a typo. */
export const MIN_MULTIPLIER_BP = NO_PREMIUM_BP;
export const MAX_MULTIPLIER_BP = 50_000;

export interface RateCardLike {
  nightMultiplierBp: number;
  holidayMultiplierBp: number;
  overtimeMultiplierBp: number;
  /** Hours held available, paid at a fraction of the rate rather than a
   *  premium — the one band that is worth *less*, not more. */
  onCallMultiplierBp: number;
}

export const DEFAULT_RATE_CARD: RateCardLike = {
  nightMultiplierBp: NO_PREMIUM_BP,
  holidayMultiplierBp: NO_PREMIUM_BP,
  overtimeMultiplierBp: NO_PREMIUM_BP,
  onCallMultiplierBp: NO_PREMIUM_BP,
};

export interface PriceableTimesheet {
  /** Mutually exclusive and summing to the billable total. */
  ordinaryMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;
  /** Overlaps the three above: time beyond the scheduled length. */
  overtimeMinutes: number;
  onCallMinutes: number;
  hourlyRateKobo: number;
}

export interface PricedLine {
  band: 'ORDINARY' | 'NIGHT' | 'HOLIDAY' | 'OVERTIME' | 'ON_CALL';
  minutes: number;
  multiplierBp: number;
  amountKobo: number;
}

export interface PricedTimesheet {
  lines: PricedLine[];
  /** What the hours would have cost with no allowances at all. */
  baseKobo: number;
  /** Everything the rate card added on top of that. */
  premiumKobo: number;
  totalKobo: number;
}

/**
 * Minutes at a rate, in integer kobo.
 *
 * One rounding, at the end of the whole expression, so a 1.5x night hour is
 * not rounded to kobo twice. Every line rounds independently and the total is
 * their sum — which means the total is what the lines say it is, rather than
 * a separately computed figure that can disagree with them by a kobo.
 */
export function lineAmountKobo(
  minutes: number,
  hourlyRateKobo: number,
  multiplierBp: number,
): number {
  return Math.round((minutes * hourlyRateKobo * multiplierBp) / (60 * NO_PREMIUM_BP));
}

/**
 * Prices a timesheet against a rate card.
 *
 * **Unsociable-hours premiums do not compound.** A minute that is both night
 * and a public holiday is paid the holiday rate, not night times holiday: two
 * multipliers applied to one minute is a rate nobody agreed to, and the
 * exclusive bands from `computeTimesheet` are what make that rule expressible
 * rather than aspirational.
 *
 * **Overtime does add**, because it answers a different question. Night pay
 * compensates for *when* the work happened; overtime compensates for the
 * shift running longer than the one that was accepted. A facility that does
 * not want them to add sets the overtime multiplier to par.
 */
export function priceTimesheet(
  sheet: PriceableTimesheet,
  card: RateCardLike = DEFAULT_RATE_CARD,
): PricedTimesheet {
  const lines: PricedLine[] = [];

  const band = (
    name: PricedLine['band'],
    minutes: number,
    multiplierBp: number,
  ): void => {
    if (minutes <= 0) return;
    lines.push({
      band: name,
      minutes,
      multiplierBp,
      amountKobo: lineAmountKobo(minutes, sheet.hourlyRateKobo, multiplierBp),
    });
  };

  band('ORDINARY', sheet.ordinaryMinutes, NO_PREMIUM_BP);
  band('NIGHT', sheet.nightMinutes, card.nightMultiplierBp);
  band('HOLIDAY', sheet.holidayMinutes, card.holidayMultiplierBp);

  // Only the *extra* over par, because those minutes are already paid once in
  // the bands above. Charging the full overtime multiplier here would pay
  // them twice over.
  const overtimeExtraBp = Math.max(0, card.overtimeMultiplierBp - NO_PREMIUM_BP);
  band('OVERTIME', sheet.overtimeMinutes, overtimeExtraBp);

  // On call is not in the billable minutes at all — it is time held
  // available rather than worked — so it is added whole.
  band('ON_CALL', sheet.onCallMinutes, card.onCallMultiplierBp);

  const totalKobo = lines.reduce((sum, line) => sum + line.amountKobo, 0);

  const billableMinutes =
    sheet.ordinaryMinutes + sheet.nightMinutes + sheet.holidayMinutes;
  const baseKobo = lineAmountKobo(billableMinutes, sheet.hourlyRateKobo, NO_PREMIUM_BP);

  return { lines, baseKobo, premiumKobo: totalKobo - baseKobo, totalKobo };
}

export type MultiplierProblem = 'below_par' | 'implausibly_high' | 'not_an_integer';

/** A rate card nobody can typo a decimal point into. */
export function multiplierProblems(bp: number): MultiplierProblem[] {
  const problems: MultiplierProblem[] = [];
  if (!Number.isInteger(bp)) problems.push('not_an_integer');
  if (bp < MIN_MULTIPLIER_BP) problems.push('below_par');
  if (bp > MAX_MULTIPLIER_BP) problems.push('implausibly_high');
  return problems;
}
