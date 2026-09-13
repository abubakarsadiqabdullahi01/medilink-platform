import { describe, expect, it } from 'vitest';
import { reliabilityFrom } from './reliability';

describe('reliabilityFrom', () => {
  it('is null when nothing has been decided', () => {
    // Not zero. A practitioner with no history is unproven, not unreliable,
    // and the engine turns null into a neutral score rather than a penalty.
    expect(reliabilityFrom({ completed: 0, noShow: 0 })).toBeNull();
  });

  it('is 1 when every decided assignment was honoured', () => {
    expect(reliabilityFrom({ completed: 4, noShow: 0 })).toBe(1);
  });

  it('is 0 when none was', () => {
    expect(reliabilityFrom({ completed: 0, noShow: 3 })).toBe(0);
  });

  it('is the honoured share of decided assignments', () => {
    expect(reliabilityFrom({ completed: 3, noShow: 1 })).toBe(0.75);
  });

  it('never leaves the unit interval', () => {
    for (let completed = 0; completed <= 12; completed += 1) {
      for (let noShow = 0; noShow <= 12; noShow += 1) {
        const score = reliabilityFrom({ completed, noShow });
        if (score === null) {
          expect(completed + noShow).toBe(0);
          continue;
        }
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });
});
