/**
 * What a practitioner can be paid now. Pure, no database.
 *
 * A practitioner is credited when work is approved and invoiced, which is when a
 * facility has been *billed*. Until the facility has paid, that credit is a promise
 * the platform has no money behind, and a payout sized from it can be made before
 * any cash has arrived (BIL-03): the cash account goes negative and the platform
 * is paying practitioners from other facilities' money.
 *
 * What can be paid is what has been collected: the credits on invoices a facility
 * has actually paid, less what has already gone out. Whether the platform should
 * instead guarantee practitioners and carry the risk of a facility that does not
 * pay is a commercial and legal decision nobody has taken (BIL-13), and the safe
 * default is not to. `PAYOUT_REQUIRES_COLLECTION=off` is for whoever takes it.
 */

export function payableKobo(input: {
  /** Credited and not yet paid, from the ledger. */
  owedKobo: number;
  /** Credited on invoices the facility has paid. */
  collectedKobo: number;
  /** Already paid out. */
  paidOutKobo: number;
  required: boolean;
}): number {
  if (!input.required) return Math.max(0, input.owedKobo);
  return Math.max(0, Math.min(input.owedKobo, input.collectedKobo - input.paidOutKobo));
}

/**
 * On unless the setting says exactly `off`: a typo must not remove a control on
 * moving money. Read each time rather than once, so changing it does not wait for
 * a restart and a test can change it.
 */
export function collectionRequired(setting: string | undefined): boolean {
  return setting !== 'off';
}
