import { logger } from '../lib/logger';
import { EVENTS } from '../lib/events';
import { grantPractitionerRoleOnRegistration } from '../modules/practitioners/application/role-grants';
import { screenPractitioner } from '../modules/practitioners/application/screening';
import { notifyAssignmentConfirmed } from '../modules/notifications/application/handlers';
import { computeAndSaveTimesheet } from '../modules/timesheets/application/timesheet';
import type { EventHandler } from './processor';

/**
 * Event handlers, registered by event type. Handlers must be idempotent:
 * a retry after a partial failure will call them again with the same payload.
 */
export type { EventHandler };

export const handlers: Record<string, EventHandler> = {
  // Step 6.5: both parties notified on confirmation. Through the outbox
  // rather than inside the confirming transaction, because holding one
  // open across an SMS gateway parks a database connection for the
  // gateway's latency — the reasoning issueOtp already documents.
  [EVENTS.AssignmentConfirmed]: async (payload) => {
    await notifyAssignmentConfirmed(payload);
  },

  /**
   * Step 7.4, the half that was missing: the timesheet is worked out when the
   * shift ends, not when the practitioner submits it.
   *
   * /practitioner/timesheets tells people "one is worked out for you as soon
   * as you check out of a shift", and both timesheet pages build their cards
   * from the timesheet row. Nothing created that row until submission, so a
   * checked-out shift appeared on neither console — the practitioner had no
   * card to submit from and no way to reach the only shift they could act on.
   *
   * Idempotent by construction: computeAndSaveTimesheet recomputes from
   * whatever attendance currently says and replaces the figures, which is
   * exactly what a retry should do.
   */
  [EVENTS.ShiftCompleted]: async (payload) => {
    await computeAndSaveTimesheet(String(payload.assignmentId ?? ''));
  },

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
