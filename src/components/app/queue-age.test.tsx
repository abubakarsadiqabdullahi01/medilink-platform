import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueueAge, ageTone, waitingFor } from './queue-age';

const now = new Date('2026-10-18T10:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

afterEach(cleanup);

describe('queue age', () => {
  it('is fresh, ageing or overdue by the thresholds, inclusive of the boundary', () => {
    expect(ageTone(hoursAgo(1), now)).toBe('fresh');
    expect(ageTone(hoursAgo(47.9), now)).toBe('fresh');
    expect(ageTone(hoursAgo(48), now)).toBe('ageing');
    expect(ageTone(hoursAgo(119), now)).toBe('ageing');
    expect(ageTone(hoursAgo(120), now)).toBe('overdue');
  });

  it('takes a queue’s own thresholds', () => {
    const incidents = { ageingAfterHours: 4, overdueAfterHours: 24 };
    expect(ageTone(hoursAgo(5), now, incidents)).toBe('ageing');
    expect(ageTone(hoursAgo(25), now, incidents)).toBe('overdue');
  });

  it('says the largest whole unit and never "0 days"', () => {
    expect(waitingFor(new Date(now.getTime() - 20_000), now)).toBe('under a minute');
    expect(waitingFor(hoursAgo(1 / 60), now)).toBe('1 minute');
    expect(waitingFor(hoursAgo(5), now)).toBe('5 hours');
    expect(waitingFor(hoursAgo(47), now)).toBe('47 hours');
    expect(waitingFor(hoursAgo(48), now)).toBe('2 days');
    expect(waitingFor(hoursAgo(24 * 9 + 5), now)).toBe('9 days');
  });

  it('puts the urgency in words, not only in colour', () => {
    render(<QueueAge since={new Date(Date.now() - 200 * 3_600_000)} />);
    expect(screen.getByText(/Waiting 8 days · overdue/)).toBeInTheDocument();
  });
});
