/**
 * What a dispute holds back from a payout. Pure, no database.
 *
 * A dispute is over one shift, so what is held is what the practitioner was
 * credited for that shift - not their whole balance, which would punish them
 * for every other shift they worked while one was argued over.
 *
 * **Payouts clear the oldest credit first.** The ledger keeps one balance per
 * practitioner rather than a balance per shift, so which shifts a payout paid is
 * not recorded; the rule is that it paid the oldest. What is still unpaid is
 * therefore the newest slice of what was credited, and a disputed shift holds
 * only the part of itself that lies inside that slice. A shift paid in full
 * last month and disputed today holds nothing, and does not hold this month's
 * earnings in its place.
 */

export interface CreditedLine {
  assignmentId: string;
  /** What the practitioner was credited for this shift, after the platform fee. */
  netKobo: number;
}

/**
 * What the practitioner was credited for one invoice line.
 *
 * The same apportionment the ledger used when the invoice was raised - the fee
 * share rounded down, the remainder left with the practitioner - so these add up
 * to what the ledger says rather than a figure one kobo different.
 */
export function netOfLine(
  line: { amountKobo: number },
  invoice: { grossKobo: number; platformFeeKobo: number },
): number {
  const share =
    invoice.grossKobo === 0
      ? 0
      : Math.floor((invoice.platformFeeKobo * line.amountKobo) / invoice.grossKobo);
  return line.amountKobo - share;
}

/**
 * Of `unpaidKobo` still owed, how much is on shifts under dispute.
 *
 * `lines` are every shift the practitioner has been credited for, oldest first.
 */
export function heldForDisputes(
  lines: CreditedLine[],
  disputed: ReadonlySet<string>,
  unpaidKobo: number,
): number {
  if (unpaidKobo <= 0 || disputed.size === 0) return 0;

  const credited = lines.reduce((total, line) => total + line.netKobo, 0);
  // The unpaid slice is the last `unpaid` of what was credited. More unpaid than
  // was ever credited means the ledger holds something the lines do not; hold
  // what was disputed rather than guess.
  const sliceStart = Math.max(0, credited - unpaidKobo);

  let held = 0;
  let start = 0;
  for (const line of lines) {
    const end = start + line.netKobo;
    if (disputed.has(line.assignmentId)) {
      held += Math.max(0, end - Math.max(start, sliceStart));
    }
    start = end;
  }
  return held;
}
