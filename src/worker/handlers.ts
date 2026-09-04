import { logger } from '../lib/logger';
import { EVENTS } from '../lib/events';

/**
 * Event handlers, registered by event type. Handlers must be idempotent:
 * a retry after a partial failure will call them again with the same payload.
 */
export type EventHandler = (payload: Record<string, unknown>) => Promise<void>;

export const handlers: Record<string, EventHandler> = {
  [EVENTS.PractitionerRegistered]: async (payload) => {
    // Stage 4.7: send the welcome message through the notification adapter.
    logger.info('practitioner registered', { userId: String(payload.userId ?? '') });
  },
};
