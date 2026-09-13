/**
 * Reliability, from outcomes that were actually decided.
 *
 * Pure, so the rule can be read and tested without a database: the engine
 * consumes the number, this decides what the number means.
 */

export interface AssignmentOutcomes {
  /** Shifts worked and approved. */
  completed: number;
  /** Shifts not honoured, where a person decided the fault was the
   *  practitioner's. Step 7.7 is what produces these. */
  noShow: number;
}

/**
 * `null` until something has been decided either way, which is not the same
 * as zero — a practitioner with no history is unproven, not unreliable, and
 * the engine's cold-start rule turns that into a neutral score rather than a
 * penalty.
 *
 * Only decided outcomes are counted. An assignment still running, one
 * cancelled by the facility, and an absence a person excused (7.8) are all
 * absent from both terms: an excusal that quietly lowered the ratio would be
 * a penalty by another name, which is exactly what 7.8 says it must not be.
 */
export function reliabilityFrom(outcomes: AssignmentOutcomes): number | null {
  const decided = outcomes.completed + outcomes.noShow;
  if (decided === 0) return null;
  return outcomes.completed / decided;
}
