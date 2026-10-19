import { describe, expect, it } from 'vitest';
import { stepName } from './step-name';

describe('stepName', () => {
  it('says the position, the label and the state', () => {
    expect(stepName(1, 4, 'When you can work', 1, false)).toBe(
      'Step 2 of 4: When you can work — current',
    );
    expect(stepName(0, 4, 'Your details', 1, true)).toBe('Step 1 of 4: Your details — done');
    expect(stepName(3, 4, 'Review and submit', 1, false)).toBe(
      'Step 4 of 4: Review and submit — to do',
    );
  });

  it('keeps a finished step that is also the open one distinguishable', () => {
    expect(stepName(0, 4, 'Your details', 0, true)).toBe(
      'Step 1 of 4: Your details — current, done',
    );
  });

  it('contains the visible label, so voice control can say it', () => {
    expect(stepName(2, 4, 'Your documents', 0, false)).toContain('Your documents');
  });
});
