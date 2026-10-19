import { describe, expect, it } from 'vitest';
import {
  readyToConfirm,
  shiftNextStep,
  shiftProgress,
  waitingOffers,
  type OfferFacts,
  type ShiftFacts,
} from './shift-progress';

const NOW = new Date('2026-10-20T08:00:00Z');
const FUTURE = '2026-10-22T07:00:00Z';
const PAST = '2026-10-19T07:00:00Z';

const shift = (over: Partial<ShiftFacts> = {}): ShiftFacts => ({
  status: 'PUBLISHED',
  headcount: 2,
  startsAt: FUTURE,
  ...over,
});
const offer = (userId: string, status: string, expiresAt = '2026-10-21T08:00:00Z'): OfferFacts => ({
  userId,
  status,
  expiresAt,
});
const none = new Set<string>();

describe('readyToConfirm', () => {
  it('leaves out somebody who is already booked, because an accepted offer stays accepted', () => {
    const offers = [offer('a', 'ACCEPTED'), offer('b', 'ACCEPTED'), offer('c', 'DECLINED')];
    expect(readyToConfirm(offers, new Set(['a'])).map((row) => row.userId)).toEqual(['b']);
  });
});

describe('waitingOffers', () => {
  it('counts only unanswered offers that have not lapsed', () => {
    const offers = [
      offer('a', 'INVITED', '2026-10-21T08:00:00Z'),
      offer('b', 'INVITED', '2026-10-20T07:00:00Z'),
      offer('c', 'ACCEPTED'),
    ];
    expect(waitingOffers(offers, NOW).map((row) => row.userId)).toEqual(['a']);
  });
});

describe('shiftNextStep', () => {
  const next = (over: Partial<Parameters<typeof shiftNextStep>[0]>) =>
    shiftNextStep({
      shift: shift(),
      confirmed: 0,
      offers: [],
      confirmedUserIds: none,
      now: NOW,
      ...over,
    });

  it('says to find candidates when nobody has been offered it', () => {
    expect(next({})).toMatchObject({ kind: 'find' });
    expect(next({}).text).toContain('Nobody has been offered');
  });

  it('puts an acceptance ahead of everything else', () => {
    const result = next({ offers: [offer('a', 'INVITED'), offer('b', 'ACCEPTED')] });
    expect(result.kind).toBe('confirm');
    expect(result.text).toContain('1 practitioner has accepted');
    expect(result.text).toContain('an acceptance alone does not');
  });

  it('does not ask to confirm somebody who is already booked', () => {
    const result = next({
      offers: [offer('a', 'ACCEPTED')],
      confirmedUserIds: new Set(['a']),
      confirmed: 1,
    });
    expect(result.kind).toBe('find');
  });

  it('says it is waiting, and when the first offer lapses, in Lagos time', () => {
    const result = next({ offers: [offer('a', 'INVITED', '2026-10-21T08:00:00Z')] });
    expect(result.kind).toBe('wait');
    expect(result.text).toContain('Waiting for 1 answer');
    expect(result.text).toContain('Lagos time');
  });

  it('asks for more candidates when every offer was declined or lapsed', () => {
    const result = next({ offers: [offer('a', 'DECLINED'), offer('b', 'EXPIRED')] });
    expect(result.kind).toBe('find');
    expect(result.text).toContain('Find more candidates');
  });

  it('does not offer a shift that has started', () => {
    expect(next({ shift: shift({ startsAt: PAST }) }).kind).toBe('started');
  });

  it('describes each state that is not open for offers', () => {
    expect(next({ shift: shift({ status: 'FILLED' }), confirmed: 2 }).text).toBe(
      'Every place is filled: 2 of 2 confirmed.',
    );
    expect(next({ shift: shift({ status: 'CANCELLED' }) }).kind).toBe('closed');
    expect(next({ shift: shift({ status: 'EXPIRED' }) }).kind).toBe('closed');
    expect(next({ shift: shift({ status: 'DRAFT' }) }).text).toContain('draft');
  });
});

describe('shiftProgress', () => {
  const progress = (confirmed: number, offers: OfferFacts[], over: Partial<ShiftFacts> = {}) =>
    shiftProgress({ shift: shift(over), confirmed, offers, confirmedUserIds: none });

  it('marks the first thing that has not happened as the current step', () => {
    const steps = progress(0, []);
    expect(steps.map((step) => step.state)).toEqual([
      'done',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
  });

  it('moves along as offers are sent, accepted and confirmed', () => {
    const steps = progress(1, [offer('a', 'ACCEPTED'), offer('b', 'INVITED')]);
    expect(steps.map((step) => step.state)).toEqual([
      'done',
      'done',
      'done',
      'current',
      'upcoming',
    ]);
    expect(steps[3]!.title).toBe('Confirmed: 1 of 2');
  });

  it('counts a waiting acceptance on the confirm step', () => {
    const steps = shiftProgress({
      shift: shift(),
      confirmed: 0,
      offers: [offer('a', 'ACCEPTED')],
      confirmedUserIds: none,
    });
    expect(steps[3]!.detail).toBe('1 acceptance waiting for you');
  });

  it('is done when the shift is filled', () => {
    const steps = progress(2, [offer('a', 'ACCEPTED')], { status: 'FILLED' });
    expect(steps.every((step) => step.state === 'done')).toBe(true);
  });

  it('draws nothing for a shift that is not live', () => {
    expect(progress(0, [], { status: 'CANCELLED' })).toEqual([]);
    expect(progress(0, [], { status: 'DRAFT' })).toEqual([]);
  });
});
