import { describe, expect, it } from 'vitest';
import { attendanceState } from './attendance-state';

// 12:00 on Sun 18 Oct 2026 in Lagos.
const now = new Date('2026-10-18T11:00:00Z');
const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();

const of = (status: string | null, startH: number, endH: number) =>
  attendanceState({ status, startsAt: at(startH), endsAt: at(endH), now });

describe('where a shift stands', () => {
  it('says when check-in opens, in Lagos time, while it is more than three hours away', () => {
    const state = of(null, 5, 13);
    expect(state.key).toBe('opens-later');
    // Three hours before 17:00 Lagos.
    expect(state.label).toBe('You can check in from 14:00');
  });

  it('opens three hours before the start, and for any code already issued', () => {
    expect(of('NOT_STARTED', 2, 10).key).toBe('check-in-open');
    expect(of('CHECK_IN_PENDING', 8, 16).key).toBe('check-in-open');
  });

  it('is late once the shift has started with nobody checked in', () => {
    const state = of('NOT_STARTED', -1, 7);
    expect(state.key).toBe('late');
    expect(state.tone).toBe('warning');
    expect(state.detail).toContain('1 hour');
  });

  it('says so when the shift ended with no check-in', () => {
    expect(of(null, -9, -1).key).toBe('unattended');
    expect(of('CHECK_IN_PENDING', -9, -1).key).toBe('unattended');
  });

  it('follows the record through check-in, check-out, submission and decision', () => {
    expect(of('CHECKED_IN', -2, 6).key).toBe('checked-in');
    expect(of('CHECKED_IN', -10, -2).key).toBe('check-out-due');
    expect(of('CHECKED_OUT', -10, -2).key).toBe('checked-out');
    expect(of('MANUALLY_CORRECTED', -10, -2).key).toBe('checked-out');
    expect(of('SUBMITTED', -10, -2).key).toBe('submitted');
    expect(of('APPROVED', -10, -2).key).toBe('approved');
    expect(of('REJECTED', -10, -2).key).toBe('rejected');
    expect(of('DISPUTED', -10, -2).key).toBe('disputed');
  });
});
