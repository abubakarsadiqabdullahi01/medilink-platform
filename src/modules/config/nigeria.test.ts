import { describe, expect, it } from 'vitest';
import { NIGERIA, TOTAL_LGAS, TOTAL_STATES } from '../../../prisma/data/nigeria';

/**
 * A hand-maintained list of 774 names is exactly the kind of thing that loses
 * one in a merge, and a missing LGA is invisible until somebody cannot find
 * their own. None of this catches a misspelling — only an authoritative
 * source does that, and the data file says so.
 */
describe('Nigeria', () => {
  it('has 36 states and the Federal Capital Territory', () => {
    expect(NIGERIA).toHaveLength(TOTAL_STATES);
    expect(NIGERIA.some((state) => state.name === 'Federal Capital Territory')).toBe(true);
  });

  it('has 774 local government areas', () => {
    const total = NIGERIA.reduce((count, state) => count + state.lgas.length, 0);
    expect(total).toBe(TOTAL_LGAS);
  });

  it('gives every state a unique code', () => {
    const codes = NIGERIA.map((state) => state.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('never repeats an LGA within a state', () => {
    for (const state of NIGERIA) {
      expect(new Set(state.lgas).size, state.name).toBe(state.lgas.length);
    }
  });

  it('gives every state at least one LGA', () => {
    for (const state of NIGERIA) {
      expect(state.lgas.length, state.name).toBeGreaterThan(0);
    }
  });

  it('uses only the six geopolitical zones', () => {
    const zones = new Set(NIGERIA.map((state) => state.zone));
    expect([...zones].sort()).toEqual([
      'North Central',
      'North East',
      'North West',
      'South East',
      'South South',
      'South West',
    ]);
  });

  it('has no leading or trailing whitespace anywhere', () => {
    // A name that round-trips through a spreadsheet picks these up, and a
    // trailing space makes two LGAs that look identical.
    for (const state of NIGERIA) {
      expect(state.name).toBe(state.name.trim());
      for (const lga of state.lgas) expect(lga, state.name).toBe(lga.trim());
    }
  });

  it('matches the counts a reader would recognise', () => {
    // Spot checks on the ones people know, so a wholesale corruption of the
    // file fails rather than merely changing the total.
    const counts = new Map(NIGERIA.map((state) => [state.name, state.lgas.length]));
    expect(counts.get('Kano')).toBe(44);
    expect(counts.get('Lagos')).toBe(20);
    expect(counts.get('Bayelsa')).toBe(8);
    expect(counts.get('Federal Capital Territory')).toBe(6);
  });
});
