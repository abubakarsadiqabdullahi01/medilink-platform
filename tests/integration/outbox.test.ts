import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import { MAX_ATTEMPTS, nextAvailableAt, publishEvent } from '@/lib/outbox';
import { runOnce, type EventHandler } from '@/worker/processor';

/**
 * Stage 4.6 — "no event is lost on consumer failure", verified by forcing a
 * consumer to throw and asserting the event is retried and eventually
 * consumed (Implementation Plan, step 4.6). This is one of the four Stage 4
 * gate conditions, and the only evidence that satisfies it is a recorded
 * failure and recovery.
 */

const AGGREGATE_ID = '11111111-1111-1111-1111-111111111111';

async function publish(overrides: { eventType?: string; payload?: Record<string, unknown> } = {}) {
  return prisma.$transaction((tx) =>
    publishEvent(tx, {
      eventType: overrides.eventType ?? EVENTS.PractitionerRegistered,
      aggregateType: 'identity.users',
      aggregateId: AGGREGATE_ID,
      payload: overrides.payload ?? { userId: AGGREGATE_ID },
    }),
  );
}

/** What the passage of the backoff window would have done. */
async function makeDue(id: string): Promise<void> {
  await prisma.outboxEvent.update({
    where: { id },
    data: { availableAt: new Date(Date.now() - 1000) },
  });
}

describe('an event survives a failing consumer', () => {
  it('retries after a throw and processes it on the next pass', async () => {
    const event = await publish();

    let calls = 0;
    const handlers: Record<string, EventHandler> = {
      [EVENTS.PractitionerRegistered]: async () => {
        calls += 1;
        if (calls === 1) throw new Error('downstream unavailable');
      },
    };

    const first = await runOnce({ handlers });
    expect(first).toMatchObject({ claimed: 1, failed: 1, processed: 0 });

    const afterFailure = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(afterFailure.status).toBe('FAILED');
    expect(afterFailure.attempts).toBe(1);
    expect(afterFailure.lastError).toContain('downstream unavailable');
    expect(afterFailure.processedAt).toBeNull();
    // Backed off rather than hammered: not due again immediately.
    expect(afterFailure.availableAt.getTime()).toBeGreaterThan(Date.now());

    // A second pass before the backoff elapses must not pick it up.
    expect(await runOnce({ handlers })).toMatchObject({ claimed: 0 });

    await makeDue(event.id);
    const second = await runOnce({ handlers });
    expect(second).toMatchObject({ claimed: 1, processed: 1, failed: 0 });

    const afterRecovery = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(afterRecovery.status).toBe('PROCESSED');
    expect(afterRecovery.processedAt).not.toBeNull();
    expect(afterRecovery.lastError).toBeNull();
    expect(calls).toBe(2);
  });

  it('backs off further with each failure', async () => {
    const event = await publish();
    const handlers: Record<string, EventHandler> = {
      [EVENTS.PractitionerRegistered]: async () => {
        throw new Error('still unavailable');
      },
    };

    const delays: number[] = [];
    for (let pass = 1; pass <= 3; pass += 1) {
      const before = new Date();
      await runOnce({ handlers, now: before });
      const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
      delays.push(row.availableAt.getTime() - before.getTime());
      expect(row.availableAt).toEqual(nextAvailableAt(pass, before));
      await makeDue(event.id);
    }

    expect(delays[1]).toBeGreaterThan(delays[0] ?? 0);
    expect(delays[2]).toBeGreaterThan(delays[1] ?? 0);
  });

  it('dead-letters only after the attempt limit, and then stops retrying', async () => {
    const event = await publish();
    const handlers: Record<string, EventHandler> = {
      [EVENTS.PractitionerRegistered]: async () => {
        throw new Error('permanently broken');
      },
    };

    for (let pass = 1; pass < MAX_ATTEMPTS; pass += 1) {
      const result = await runOnce({ handlers });
      expect(result, `pass ${pass} should retry, not dead-letter`).toMatchObject({
        failed: 1,
        deadLettered: 0,
      });

      const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(row.status).toBe('FAILED');
      expect(row.attempts).toBe(pass);

      await makeDue(event.id);
    }

    const final = await runOnce({ handlers });
    expect(final).toMatchObject({ claimed: 1, deadLettered: 1 });

    const dead = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(dead.status).toBe('DEAD_LETTER');
    expect(dead.attempts).toBe(MAX_ATTEMPTS);

    // A dead letter is an operator's queue, not a retry loop: it must not be
    // claimed again, however long the worker runs.
    await makeDue(event.id);
    expect(await runOnce({ handlers })).toMatchObject({ claimed: 0 });
  });
});

describe('the outbox is transactional', () => {
  it('publishes nothing when the transaction that wrote it rolls back', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await publishEvent(tx, {
          eventType: EVENTS.PractitionerRegistered,
          aggregateType: 'identity.users',
          aggregateId: AGGREGATE_ID,
          payload: { userId: AGGREGATE_ID },
        });
        throw new Error('the state change failed');
      }),
    ).rejects.toThrow('the state change failed');

    // The whole point of the outbox: no event without the state change, and
    // no state change without the event.
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('refuses a duplicate idempotency key', async () => {
    const publishWithKey = () =>
      prisma.$transaction((tx) =>
        publishEvent(tx, {
          eventType: EVENTS.PaymentCompleted,
          aggregateType: 'billing.payments',
          aggregateId: AGGREGATE_ID,
          payload: { amountKobo: 250_000 },
          idempotencyKey: 'paystack:evt_123',
        }),
      );

    await publishWithKey();
    // A replayed webhook must not become a second event to consume.
    await expect(publishWithKey()).rejects.toThrow();
    expect(await prisma.outboxEvent.count()).toBe(1);
  });
});

describe('dispatch', () => {
  it('hands the payload to the handler unchanged', async () => {
    await publish({ payload: { userId: AGGREGATE_ID, phone: '+234803*****01' } });

    const seen: Record<string, unknown>[] = [];
    await runOnce({
      handlers: {
        [EVENTS.PractitionerRegistered]: async (payload) => {
          seen.push(payload);
        },
      },
    });

    expect(seen).toEqual([{ userId: AGGREGATE_ID, phone: '+234803*****01' }]);
  });

  it('does not retry an event type nothing consumes yet', async () => {
    // Modules arrive stage by stage; an unconsumed event must not accumulate
    // attempts and eventually dead-letter for having no audience.
    const event = await publish({ eventType: EVENTS.TimesheetApproved });

    const result = await runOnce({ handlers: {} });
    expect(result).toMatchObject({ claimed: 1, skipped: 1, failed: 0 });

    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.status).toBe('PROCESSED');
  });

  it('delivers each event once when two workers run at the same time', async () => {
    const published = await Promise.all([publish(), publish(), publish(), publish(), publish()]);

    const delivered: string[] = [];
    const handlers: Record<string, EventHandler> = {
      [EVENTS.PractitionerRegistered]: async (payload) => {
        // Hold the pass open long enough for the two workers to overlap.
        await new Promise((resolve) => setTimeout(resolve, 15));
        delivered.push(String(payload.userId));
      },
    };

    const [a, b] = await Promise.all([runOnce({ handlers }), runOnce({ handlers })]);

    // SKIP LOCKED is what makes this true: neither worker waits for the
    // other, and neither picks up an event the other has claimed.
    expect(a.claimed + b.claimed).toBe(published.length);
    expect(delivered).toHaveLength(published.length);

    const rows = await prisma.outboxEvent.findMany({ select: { status: true, attempts: true } });
    expect(rows.every((row) => row.status === 'PROCESSED')).toBe(true);
    expect(rows.every((row) => row.attempts === 1)).toBe(true);
  });
});
