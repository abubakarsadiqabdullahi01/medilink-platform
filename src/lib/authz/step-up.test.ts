import { describe, expect, it } from 'vitest';
import { PERMISSIONS, STEP_UP_PERMISSIONS, requiresStepUp } from './permissions';

/**
 * Step 4.8. The mechanism is tested where it is enforced, in the integration
 * suite; what is tested here is the declaration itself, because the set is
 * the whole policy.
 */
describe('which permissions need a fresh password', () => {
  it('names only permissions that exist', () => {
    for (const permission of STEP_UP_PERMISSIONS) {
      expect(Object.keys(PERMISSIONS), permission).toContain(permission);
    }
  });

  it('includes the one the catalogue already says so in words', () => {
    // "Change a payout bank account (requires step-up auth)" — this is the
    // same statement in a form the code can act on.
    expect(PERMISSIONS['payout.account.change']).toContain('step-up');
    expect(requiresStepUp('payout.account.change')).toBe(true);
  });

  it('includes granting a role', () => {
    // How an attacker with one session gets a durable second one.
    expect(requiresStepUp('role.grant')).toBe(true);
  });

  it('leaves ordinary work alone', () => {
    // A prompt on everything is a prompt nobody reads. These are the daily
    // acts of the three main roles.
    for (const permission of [
      'service_request.publish',
      'assignment.confirm',
      'attendance.record',
      'timesheet.submit',
      'timesheet.approve',
      'credential.submit',
      'availability.write',
    ] as const) {
      expect(requiresStepUp(permission), permission).toBe(false);
    }
  });

  it('stays small', () => {
    // Not a rule the code can enforce, but a number worth having to change
    // deliberately: the bar is moving money to a new destination, or handing
    // somebody else the ability to.
    expect(STEP_UP_PERMISSIONS.size).toBeLessThanOrEqual(4);
  });
});
