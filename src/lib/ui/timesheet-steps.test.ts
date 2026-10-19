import { describe, expect, it } from 'vitest';
import { timesheetSteps } from './timesheet-steps';

const states = (status: string, extra: object = {}) =>
  timesheetSteps({ status, ...extra }).map((step) => `${step.id}:${step.state}`);

describe('a timesheet, step by step', () => {
  it('asks to be sent while the hours are worked and not yet sent', () => {
    expect(states('CHECKED_OUT')).toEqual([
      'worked:done',
      'sent:current',
      'decision:upcoming',
      'paid:upcoming',
    ]);
    expect(states('MANUALLY_CORRECTED')[1]).toBe('sent:current');
  });

  it('waits on the facility once sent', () => {
    expect(states('SUBMITTED')).toEqual([
      'worked:done',
      'sent:done',
      'decision:current',
      'paid:upcoming',
    ]);
  });

  it('marks an approval done and leaves payment still to come', () => {
    expect(states('APPROVED')).toEqual(['worked:done', 'sent:done', 'decision:done', 'paid:upcoming']);
  });

  it('reports a rejection as a problem, with what the facility said', () => {
    const steps = timesheetSteps({ status: 'REJECTED', rejectionReason: 'Break was 30 minutes' });
    expect(steps[2]).toMatchObject({ state: 'problem' });
    expect(steps[2]!.detail).toBe('They said: Break was 30 minutes');
    expect(timesheetSteps({ status: 'REJECTED' })[2]!.detail).toMatch(/did not say why/);
  });

  it('marks a dispute as a problem', () => {
    expect(states('DISPUTED')[2]).toBe('decision:problem');
  });
});
