/**
 * Moves `Date` forward by CLOCK_OFFSET_HOURS, so a test that only passes on the day or at the hour
 * it was written shows itself. Only the JavaScript clock moves: the database's `now()` does not,
 * so an integration failure under an offset is a lead to read, not a verdict.
 *
 * Run with the shifted configs, for example
 *   CLOCK_OFFSET_HOURS=720 pnpm vitest run --config vitest.shift.config.mts
 *   CLOCK_OFFSET_HOURS=720 pnpm vitest run --config vitest.integration.shift.config.mts
 * (the integration one needs the same database setup as `pnpm test:integration`). Offsets worth
 * trying: 11 and 36 (another hour and weekday), 720 (30 days: an invitation lasts 7, a dispute can
 * be opened for 14), 2880 and 9600 (four and thirteen months).
 */
const hours = Number(process.env.CLOCK_OFFSET_HOURS ?? 0);
if (hours) {
  const RealDate = Date;
  const offset = hours * 3_600_000;
  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [number]));
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate as unknown as DateConstructor;
}
