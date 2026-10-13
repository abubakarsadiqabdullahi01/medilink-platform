import { describe, expect, it } from 'vitest';
import { isContactOpen } from './contact';

const HOUR = 60 * 60 * 1000;
const START = new Date('2026-11-10T19:00:00Z');
const END = new Date('2026-11-11T07:00:00Z');

function at(offsetHoursFromStart: number) {
  return new Date(START.getTime() + offsetHoursFromStart * HOUR);
}

describe('when a facility may see a practitioner’s phone number', () => {
  it('stays closed until two days before the shift', () => {
    expect(isContactOpen({ status: 'CONFIRMED', startsAt: START, endsAt: END, now: at(-72) })).toBe(false);
    expect(isContactOpen({ status: 'CONFIRMED', startsAt: START, endsAt: END, now: at(-48.01) })).toBe(false);
  });

  it('opens 48 hours before the start and stays open through the shift', () => {
    expect(isContactOpen({ status: 'CONFIRMED', startsAt: START, endsAt: END, now: at(-48) })).toBe(true);
    expect(isContactOpen({ status: 'CONFIRMED', startsAt: START, endsAt: END, now: at(-1) })).toBe(true);
    expect(isContactOpen({ status: 'CONFIRMED', startsAt: START, endsAt: END, now: at(6) })).toBe(true);
  });

  it('closes 24 hours after the shift ends, because after that there is nothing to coordinate', () => {
    expect(isContactOpen({ status: 'COMPLETED', startsAt: START, endsAt: END, now: new Date(END.getTime() + 24 * HOUR) })).toBe(true);
    expect(isContactOpen({ status: 'COMPLETED', startsAt: START, endsAt: END, now: new Date(END.getTime() + 24 * HOUR + 1) })).toBe(false);
  });

  it('is open after a no-show inside the window, so the ward can chase it', () => {
    expect(isContactOpen({ status: 'NO_SHOW', startsAt: START, endsAt: END, now: at(13) })).toBe(true);
  });

  it('is never open for a cancelled assignment', () => {
    expect(isContactOpen({ status: 'CANCELLED', startsAt: START, endsAt: END, now: at(0) })).toBe(false);
  });
});
