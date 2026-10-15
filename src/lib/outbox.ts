import type { Tx } from './db';
import { currentTrace } from './trace';

/**
 * Transactional outbox. Publishing an event means writing a row in the same
 * transaction as the state change; the worker delivers it afterwards. A
 * consumer that throws does not lose the event — it is retried with backoff
 * and lands in DEAD_LETTER only after the attempt limit.
 */
export interface DomainEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  /** Set for financial and webhook-driven events so replay is safe. */
  idempotencyKey?: string;
}

export async function publishEvent(tx: Tx, event: DomainEventInput) {
  return tx.outboxEvent.create({
    data: {
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload as object,
      // The action that published it, so the worker's part of the story carries the same id (AUD-13).
      correlationId: event.correlationId ?? currentTrace()?.correlationId,
      idempotencyKey: event.idempotencyKey,
    },
  });
}

export const MAX_ATTEMPTS = 8;

/** Exponential backoff, capped at fifteen minutes. */
export function nextAvailableAt(attempts: number, now = new Date()): Date {
  const seconds = Math.min(2 ** attempts * 5, 900);
  return new Date(now.getTime() + seconds * 1000);
}
