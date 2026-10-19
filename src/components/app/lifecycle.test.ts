import { describe, expect, it } from 'vitest';
import { leastAdvancedAttendance, lifecycleOf, turnLabel, type LifecycleInput } from './lifecycle';

const BASE: LifecycleInput = {
  published: true,
  offered: false,
  accepted: false,
  confirmed: false,
  started: false,
  attendance: null,
};

describe('lifecycleOf', () => {
  it('asks the facility to publish a draft', () => {
    expect(lifecycleOf({ ...BASE, published: false })).toMatchObject({ current: 0, turn: 'facility' });
  });

  it('asks the facility to find somebody when nothing has been offered', () => {
    expect(lifecycleOf(BASE)).toMatchObject({ current: 1, turn: 'facility' });
  });

  it('waits on the practitioner while offers are out', () => {
    expect(lifecycleOf({ ...BASE, offered: true })).toMatchObject({ current: 2, turn: 'practitioner' });
  });

  it('puts an accepted offer back with the facility, and says it is not a booking yet', () => {
    const result = lifecycleOf({ ...BASE, offered: true, accepted: true });
    expect(result).toMatchObject({ current: 2, turn: 'facility' });
    expect(result.message).toMatch(/not a booking until/i);
  });

  it('waits for the shift once confirmed, then for a check-in, then for the end', () => {
    const confirmed = { ...BASE, offered: true, confirmed: true };
    expect(lifecycleOf(confirmed)).toMatchObject({ current: 3, turn: 'practitioner' });
    expect(lifecycleOf({ ...confirmed, started: true }).message).toMatch(/check in/i);
    expect(lifecycleOf({ ...confirmed, started: true, attendance: 'CHECKED_IN' }).message).toMatch(/check out/i);
  });

  it('asks the practitioner for their hours after the shift, the facility once they are in', () => {
    const worked = { ...BASE, offered: true, confirmed: true, started: true };
    expect(lifecycleOf({ ...worked, attendance: 'CHECKED_OUT' })).toMatchObject({ current: 4, turn: 'practitioner' });
    expect(lifecycleOf({ ...worked, attendance: 'SUBMITTED' })).toMatchObject({ current: 4, turn: 'facility' });
  });

  it('sends rejected hours back to the practitioner and disputed hours to Medilink', () => {
    const worked = { ...BASE, offered: true, confirmed: true, started: true };
    expect(lifecycleOf({ ...worked, attendance: 'REJECTED' })).toMatchObject({ current: 4, turn: 'practitioner' });
    expect(lifecycleOf({ ...worked, attendance: 'DISPUTED' })).toMatchObject({ current: 4, turn: 'medilink' });
  });

  it('is waiting on payment, with Medilink, once the hours are approved', () => {
    const worked = { ...BASE, offered: true, confirmed: true, started: true };
    expect(lifecycleOf({ ...worked, attendance: 'APPROVED' })).toMatchObject({ current: 5, turn: 'medilink' });
    expect(lifecycleOf({ ...worked, attendance: 'MANUALLY_CORRECTED' })).toMatchObject({ current: 5 });
  });

  it('treats a completed assignment with no attendance row as waiting for the facility', () => {
    const result = lifecycleOf({ ...BASE, offered: true, confirmed: true, started: true, completed: true });
    expect(result).toMatchObject({ current: 4, turn: 'facility' });
  });
});

describe('leastAdvancedAttendance', () => {
  it('is as far along as the person furthest behind', () => {
    expect(leastAdvancedAttendance(['APPROVED', 'CHECKED_IN', 'SUBMITTED'])).toBe('CHECKED_IN');
    expect(leastAdvancedAttendance(['APPROVED', 'APPROVED'])).toBe('APPROVED');
  });

  it('counts a person with no record as behind everybody', () => {
    expect(leastAdvancedAttendance(['SUBMITTED', null])).toBeNull();
    expect(leastAdvancedAttendance([])).toBeNull();
  });
});

describe('turnLabel', () => {
  it('says "Your turn" to the one whose turn it is, and who it is otherwise', () => {
    expect(turnLabel('facility', 'facility')).toBe('Your turn');
    expect(turnLabel('facility', 'practitioner')).toBe('Waiting for the facility');
    expect(turnLabel('practitioner', 'facility')).toBe('Waiting for the practitioner');
    expect(turnLabel('medilink', 'practitioner')).toBe('Waiting for Medilink');
    expect(turnLabel(null, 'facility')).toBe('Nothing is needed');
  });
});
