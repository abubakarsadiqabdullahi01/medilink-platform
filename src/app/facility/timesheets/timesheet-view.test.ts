import { describe, expect, it } from 'vitest';
import { changedHours, earlierFigures, firstWorkedOut, spansDays } from './timesheet-view';

const revision = (n: number, previous: Record<string, unknown>) => ({
  revision: n,
  previous,
  reason: 'why',
  createdAt: '2026-10-18T09:00:00.000Z',
});

describe('earlierFigures', () => {
  it('reads what is there and nothing else', () => {
    expect(
      earlierFigures(
        revision(1, {
          billableMinutes: 480,
          amountKobo: 4_000_000,
          checkedInAt: '2026-10-18T07:00:00.000Z',
          checkedOutAt: null,
        }),
      ),
    ).toEqual({
      revision: 1,
      billableMinutes: 480,
      amountKobo: 4_000_000,
      checkedInAt: '2026-10-18T07:00:00.000Z',
      checkedOutAt: null,
    });
  });

  it('treats a figure that is not a number as unknown rather than zero', () => {
    const figures = earlierFigures(revision(1, { billableMinutes: '480', amountKobo: NaN }));
    expect(figures.billableMinutes).toBeNull();
    expect(figures.amountKobo).toBeNull();
  });
});

describe('firstWorkedOut', () => {
  it('is the oldest revision whatever order they arrive in', () => {
    const first = firstWorkedOut([
      revision(3, { billableMinutes: 420 }),
      revision(1, { billableMinutes: 480 }),
      revision(2, { billableMinutes: 450 }),
    ]);
    expect(first?.revision).toBe(1);
    expect(first?.billableMinutes).toBe(480);
  });

  it('is null for a sheet nobody has changed', () => {
    expect(firstWorkedOut([])).toBeNull();
  });
});

describe('changedHours', () => {
  it('is signed: fewer hours now is negative', () => {
    expect(changedHours({ billableMinutes: 450 }, [revision(1, { billableMinutes: 480 })])).toEqual(
      {
        from: 480,
        to: 450,
        difference: -30,
      },
    );
  });

  it('is null when a correction left the hours as they were', () => {
    expect(
      changedHours({ billableMinutes: 480 }, [revision(1, { billableMinutes: 480 })]),
    ).toBeNull();
  });

  it('is null when the first version recorded no hours', () => {
    expect(changedHours({ billableMinutes: 480 }, [revision(1, {})])).toBeNull();
  });
});

describe('spansDays', () => {
  it('is false inside one Lagos day', () => {
    expect(spansDays('2026-10-18T07:00:00.000Z', '2026-10-18T15:00:00.000Z')).toBe(false);
  });

  it('is true across midnight in Lagos even when UTC has not turned over', () => {
    // 23:30 and 00:30 WAT: the same UTC day, two Lagos days.
    expect(spansDays('2026-10-18T22:30:00.000Z', '2026-10-18T23:30:00.000Z')).toBe(true);
  });

  it('is false when a time is missing', () => {
    expect(spansDays(null, '2026-10-18T15:00:00.000Z')).toBe(false);
  });
});
