import { describe, expect, it } from 'vitest';
import {
  ACTIVE_POLL_MS,
  IDLE_PASSES_BEFORE_RELAXING,
  JOB_CHECK_MS,
  RELAXED_POLL_MS,
  jobsCheckDue,
  nextOutboxDelay,
} from './polling';

describe('how often the outbox is polled', () => {
  it('stays quick while work is arriving and for a minute after', () => {
    expect(nextOutboxDelay(0)).toBe(ACTIVE_POLL_MS);
    expect(nextOutboxDelay(IDLE_PASSES_BEFORE_RELAXING - 1)).toBe(ACTIVE_POLL_MS);
  });

  it('relaxes once it has been quiet for a while, and no further', () => {
    expect(nextOutboxDelay(IDLE_PASSES_BEFORE_RELAXING)).toBe(RELAXED_POLL_MS);
    expect(nextOutboxDelay(1_000_000)).toBe(RELAXED_POLL_MS);
  });

  it('never makes a sign-up wait longer than the sign-up screen will', () => {
    // The screen waits about eight seconds for the role grant to arrive.
    expect(RELAXED_POLL_MS).toBeLessThan(8_000);
  });

  it('a minute of idleness is what "relaxed" means', () => {
    expect(IDLE_PASSES_BEFORE_RELAXING * ACTIVE_POLL_MS).toBe(60_000);
  });
});

describe('when the scheduled jobs are checked', () => {
  it('checks at once the first time', () => {
    expect(jobsCheckDue(null, 1_000)).toBe(true);
  });

  it('then not again until the interval has passed', () => {
    expect(jobsCheckDue(0, JOB_CHECK_MS - 1)).toBe(false);
    expect(jobsCheckDue(0, JOB_CHECK_MS)).toBe(true);
  });
});
