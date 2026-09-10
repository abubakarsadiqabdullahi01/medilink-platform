import { logger } from '../lib/logger';
import { EVENTS } from '../lib/events';
import { grantPractitionerRoleOnRegistration } from '../modules/practitioners/application/role-grants';
import { screenPractitioner } from '../modules/practitioners/application/screening';
import type { EventHandler } from './processor';

/**
 * Event handlers, registered by event type. Handlers must be idempotent:
 * a retry after a partial failure will call them again with the same payload.
 */
export type { EventHandler };

export const handlers: Record<string, EventHandler> = {
  [EVENTS.PractitionerRegistered]: async (payload) => {
    // Stage 4.7: send the welcome message through the notification adapter.
    logger.info('practitioner registered', { userId: String(payload.userId ?? '') });
    await grantPractitionerRoleOnRegistration(String(payload.userId ?? ''));

    // Step 5.6 screens at registration as well as on a schedule: a name
    // already on the list should never reach a first shift, and waiting
    // for tonight's sweep is a window nobody needs to leave open.
    await screenPractitioner(String(payload.userId ?? ''));
  },
};
