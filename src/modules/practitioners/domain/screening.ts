/**
 * Sanctioned and "quack" list screening: pure, no database.
 *
 * The governing asymmetry: a false positive costs a compliance officer five
 * minutes, and a false negative puts a struck-off practitioner on a ward.
 * Every judgement below is therefore deliberately loose — it matches more
 * than it strictly should, and a person answers the flags.
 */

/** Titles carry no identity and are written inconsistently. */
const TITLES = new Set([
  'dr',
  'doctor',
  'prof',
  'professor',
  'mr',
  'mrs',
  'ms',
  'miss',
  'sir',
  'nurse',
  'pharm',
  'engr',
  'alhaji',
  'alhaja',
  'chief',
]);

/**
 * The comparable form of a name: lowercase, no punctuation, no titles, and
 * the remaining words sorted.
 *
 * Sorting is what makes "Amina Yusuf" and "Yusuf Amina" the same person.
 * Nigerian names are routinely written in either order, and a screening list
 * that missed the reversal would be trivially defeated by filling the form
 * the other way round.
 */
export function normaliseName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !TITLES.has(word))
    .sort()
    .join(' ');
}

export function normaliseFolio(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalised = raw.replace(/\s+/g, '').toUpperCase();
  return normalised.length > 0 ? normalised : null;
}

export type MatchedOn = 'name' | 'folio';

export interface ScreeningCandidate {
  fullName: string;
  folioNumbers: string[];
}

export interface SanctionedEntryLike {
  id: string;
  normalisedName: string;
  folioNumber: string | null;
}

export interface ScreeningMatch {
  entryId: string;
  matchedOn: MatchedOn;
}

/**
 * A folio match is checked first and reported as such: it is the stronger
 * signal, and it tells a reviewer to look at the registration rather than
 * wonder whether two people share a name.
 */
export function findSanctionMatch(
  candidate: ScreeningCandidate,
  entries: SanctionedEntryLike[],
): ScreeningMatch | null {
  const folios = new Set(
    candidate.folioNumbers.map(normaliseFolio).filter((folio): folio is string => folio !== null),
  );

  for (const entry of entries) {
    if (entry.folioNumber && folios.has(entry.folioNumber)) {
      return { entryId: entry.id, matchedOn: 'folio' };
    }
  }

  const name = normaliseName(candidate.fullName);
  if (name.length === 0) return null;

  for (const entry of entries) {
    if (entry.normalisedName === name) return { entryId: entry.id, matchedOn: 'name' };
  }

  return null;
}

export type ScreeningStatusValue = 'PENDING' | 'CLEAR' | 'FLAGGED';

export interface ScreeningSnapshot {
  status: ScreeningStatusValue;
}

/**
 * Only CLEAR is clear. PENDING means nobody has looked — which is not the
 * same as looking and finding nothing, and treating it as though it were is
 * how an unscreened practitioner reaches a shift.
 */
export function isScreeningClear(screening: ScreeningSnapshot | null | undefined): boolean {
  return screening?.status === 'CLEAR';
}
