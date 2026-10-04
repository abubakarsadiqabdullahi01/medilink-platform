import { describe, expect, it } from 'vitest';
import { AUDIT_AREAS, AUDIT_AREA_LABELS, AUDIT_AREA_VALUES, areaOf } from './audit-areas';

/**
 * Every action subject written anywhere in the product.
 *
 * Held here rather than derived, because the actions are string literals at
 * seventy call sites and a scan of the source would miss the ones built in a
 * ternary. The point is the tripwire: a module that starts writing a new
 * subject fails this test until somebody decides which area it belongs to,
 * rather than writing rows the area filter quietly hides.
 */
const SUBJECTS_IN_USE = [
  'agreement',
  'assignment',
  'attendance',
  'auth',
  'availability',
  'credential',
  'data_subject',
  'dispute',
  'excusal',
  'facility',
  'incident',
  'invoice',
  'matching',
  'payout',
  'practitioner',
  'rate_card',
  'role',
  'service_request',
  'suggestion',
  'timesheet',
  'user',
];

describe('audit areas', () => {
  it('claims every subject in use', () => {
    for (const subject of SUBJECTS_IN_USE) {
      expect(areaOf(`${subject}.something`), subject).not.toBeNull();
    }
  });

  it('claims each subject exactly once', () => {
    // Two areas claiming one subject would mean a row appearing under both,
    // and a count that does not add up to the trail.
    const seen = new Set<string>();
    for (const subjects of Object.values(AUDIT_AREAS)) {
      for (const subject of subjects) {
        expect(seen.has(subject), subject).toBe(false);
        seen.add(subject);
      }
    }
  });

  it('claims nothing that is not written', () => {
    // An area offering a filter that can only ever return nothing is a filter
    // somebody tries once and stops trusting.
    for (const subjects of Object.values(AUDIT_AREAS)) {
      for (const subject of subjects) {
        expect(SUBJECTS_IN_USE, subject).toContain(subject);
      }
    }
  });

  it('gives every area a name somebody would say', () => {
    for (const area of AUDIT_AREA_VALUES) {
      expect(AUDIT_AREA_LABELS[area], area).toBeTruthy();
    }
  });

  it('does not claim an unknown subject', () => {
    expect(areaOf('sausages.grilled')).toBeNull();
    expect(areaOf('malformed')).toBeNull();
  });
});
