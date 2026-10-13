import { describe, expect, it } from 'vitest';
import { findSanctionMatch, isScreeningClear, normaliseFolio, normaliseName } from './screening';

describe('normaliseName', () => {
  it('ignores case and punctuation', () => {
    expect(normaliseName('Amina Yusuf')).toBe(normaliseName('AMINA  yusuf'));
    expect(normaliseName("Amina O'Yusuf-Bello")).toBe(normaliseName('amina o yusuf bello'));
  });

  it('ignores titles, which carry no identity', () => {
    expect(normaliseName('Dr Amina Yusuf')).toBe(normaliseName('Amina Yusuf'));
    expect(normaliseName('Prof. Amina Yusuf')).toBe(normaliseName('Amina Yusuf'));
    expect(normaliseName('Chief Alhaji Amina Yusuf')).toBe(normaliseName('Amina Yusuf'));
  });

  it('treats a reordered name as the same name', () => {
    // Nigerian names are routinely written either way round. A list that
    // missed the reversal would be defeated by filling the form backwards.
    expect(normaliseName('Amina Yusuf')).toBe(normaliseName('Yusuf Amina'));
    expect(normaliseName('Chinedu Emeka Okafor')).toBe(normaliseName('Okafor Chinedu Emeka'));
  });

  it('drops single letters, so initials do not decide a match', () => {
    expect(normaliseName('Amina O Yusuf')).toBe(normaliseName('Amina Yusuf'));
  });

  it('does not collapse different people onto each other', () => {
    expect(normaliseName('Amina Yusuf')).not.toBe(normaliseName('Amina Yusuff'));
    expect(normaliseName('Amina Yusuf')).not.toBe(normaliseName('Fatima Yusuf'));
  });

  it('returns empty for a name with nothing usable in it', () => {
    expect(normaliseName('Dr.')).toBe('');
    expect(normaliseName('123')).toBe('');
  });
});

describe('normaliseFolio', () => {
  it('makes inconsistently written folios comparable', () => {
    expect(normaliseFolio(' mdcn/r/ 12345 ')).toBe('MDCN/R/12345');
  });

  it('treats absent and empty as absent', () => {
    expect(normaliseFolio(null)).toBeNull();
    expect(normaliseFolio(undefined)).toBeNull();
    expect(normaliseFolio('   ')).toBeNull();
  });
});

describe('findSanctionMatch', () => {
  const struckOff = {
    id: 'entry-1',
    normalisedName: normaliseName('Amina Yusuf'),
    folioNumber: 'MDCN/R/12345',
  };
  const other = {
    id: 'entry-2',
    normalisedName: normaliseName('Fatima Bello'),
    folioNumber: null,
  };

  it('finds nothing when the list is empty', () => {
    expect(findSanctionMatch({ fullName: 'Amina Yusuf', folioNumbers: [] }, [])).toBeNull();
  });

  it('matches a listed name', () => {
    expect(
      findSanctionMatch({ fullName: 'Dr Amina Yusuf', folioNumbers: [] }, [other, struckOff]),
    ).toEqual({ entryId: 'entry-1', matchedOn: 'name' });
  });

  it('matches a listed name written the other way round', () => {
    expect(findSanctionMatch({ fullName: 'Yusuf Amina', folioNumbers: [] }, [struckOff])).toEqual({
      entryId: 'entry-1',
      matchedOn: 'name',
    });
  });

  it('matches a listed folio even when the name differs', () => {
    // Somebody re-registering under a new name is exactly what the folio
    // check is for.
    expect(
      findSanctionMatch(
        { fullName: 'Completely Different Person', folioNumbers: ['mdcn/r/12345'] },
        [struckOff],
      ),
    ).toEqual({ entryId: 'entry-1', matchedOn: 'folio' });
  });

  it('prefers the folio match, as the stronger signal', () => {
    const nameOnly = {
      id: 'entry-3',
      normalisedName: normaliseName('Amina Yusuf'),
      folioNumber: null,
    };
    expect(
      findSanctionMatch({ fullName: 'Amina Yusuf', folioNumbers: ['MDCN/R/12345'] }, [
        nameOnly,
        struckOff,
      ]),
    ).toEqual({ entryId: 'entry-1', matchedOn: 'folio' });
  });

  it('does not match somebody who is not on the list', () => {
    expect(
      findSanctionMatch({ fullName: 'Chinedu Okafor', folioNumbers: ['MDCN/R/99999'] }, [
        struckOff,
        other,
      ]),
    ).toBeNull();
  });

  it('does not match an unusable name against an unusable entry', () => {
    // Two empty normalised names must not be "the same person".
    const empty = { id: 'entry-4', normalisedName: '', folioNumber: null };
    expect(findSanctionMatch({ fullName: 'Dr.', folioNumbers: [] }, [empty])).toBeNull();
  });
});

describe('isScreeningClear', () => {
  it('accepts only CLEAR', () => {
    expect(isScreeningClear({ status: 'CLEAR' })).toBe(true);
    expect(isScreeningClear({ status: 'FLAGGED' })).toBe(false);
  });

  it('refuses PENDING, which means nobody has looked', () => {
    // Not the same as looking and finding nothing, and treating it as though
    // it were is how an unscreened practitioner reaches a shift.
    expect(isScreeningClear({ status: 'PENDING' })).toBe(false);
    expect(isScreeningClear(null)).toBe(false);
    expect(isScreeningClear(undefined)).toBe(false);
  });
});
