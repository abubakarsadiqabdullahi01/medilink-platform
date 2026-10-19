import { lagosDayKey } from '@/lib/ui/agenda';

/**
 * Reading a timesheet and its earlier versions, for the facility's review screen.
 *
 * The API returns the current figures and, for every correction or recalculation, the whole
 * previous state with the reason. There is no "as submitted" field, so what can be said honestly
 * is what the first version on record was — "first worked out" — and how the figures differ now.
 * Kept here, apart from the screen, so those rules are tested without one.
 */

export interface RevisionView {
  revision: number;
  /** The whole earlier state of the sheet; JSON, so read defensively. */
  previous: Record<string, unknown>;
  reason: string;
  createdAt: string;
}

export interface EarlierFigures {
  revision: number;
  billableMinutes: number | null;
  amountKobo: number | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
}

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export function earlierFigures(revision: RevisionView): EarlierFigures {
  return {
    revision: revision.revision,
    billableMinutes: asNumber(revision.previous.billableMinutes),
    amountKobo: asNumber(revision.previous.amountKobo),
    checkedInAt: asText(revision.previous.checkedInAt),
    checkedOutAt: asText(revision.previous.checkedOutAt),
  };
}

/** The oldest version kept: the hours as they were first worked out. */
export function firstWorkedOut(revisions: RevisionView[]): EarlierFigures | null {
  const oldest = [...revisions].sort((a, b) => a.revision - b.revision)[0];
  return oldest ? earlierFigures(oldest) : null;
}

/**
 * How the billable hours now differ from the first version, or `null` when nothing moved or the
 * first version did not record hours. `difference` is signed: negative is fewer hours now.
 */
export function changedHours(
  current: { billableMinutes: number },
  revisions: RevisionView[],
): { from: number; to: number; difference: number } | null {
  const first = firstWorkedOut(revisions);
  if (!first || first.billableMinutes === null) return null;
  if (first.billableMinutes === current.billableMinutes) return null;
  return {
    from: first.billableMinutes,
    to: current.billableMinutes,
    difference: current.billableMinutes - first.billableMinutes,
  };
}

/** Whether a stretch of time crosses midnight in Lagos — so "out 08:05" can say it is the next day. */
export function spansDays(from: string | null, to: string | null): boolean {
  if (!from || !to) return false;
  return lagosDayKey(new Date(from)) !== lagosDayKey(new Date(to));
}
