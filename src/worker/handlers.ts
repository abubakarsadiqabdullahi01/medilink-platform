import { logger } from '../lib/logger';
import { EVENTS } from '../lib/events';
import { grantPractitionerRoleOnRegistration } from '../modules/practitioners/application/role-grants';
import { screenPractitioner } from '../modules/practitioners/application/screening';
import {
  notifyAssignmentCancelled,
  notifyAssignmentConfirmed,
  notifyDisputeStage,
  notifyIncidentReported,
  notifyInvoiceIssued,
  notifyPayoutAccountReviewed,
  notifyPayoutAccountSubmitted,
  notifyPayoutSettled,
  notifyTimesheetRejected,
  notifyStaffAccessRemoved,
  notifyStaffInvited,
  notifyStaffInvitationAnswered,
} from '../modules/notifications/application/handlers';
import {
  notifyCredentialExpired,
  notifyCredentialInfoRequested,
  notifyCredentialRejected,
  notifyCredentialVerified,
  notifyDisputeOpened,
  notifyFacilityVerified,
  notifyShiftAccepted,
  notifyShiftInvited,
  notifySuggestionAnswered,
  notifyTimesheetApproved,
  notifyTimesheetRecalculated,
  notifyTimesheetSubmitted,
} from '../modules/notifications/application/event-handlers';
import {
  completeAssignmentOfApprovedSheet,
  computeAndSaveTimesheet,
} from '../modules/timesheets/application/timesheet';
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

  // The other direction: a facility releasing somebody, or cancelling the
  // whole shift, has to reach the practitioner who would otherwise turn up.
  [EVENTS.AssignmentCancelled]: async (payload) => {
    await notifyAssignmentCancelled(payload);
  },

  // NOT-01: the messages people were never sent. Each throws if the text did
  // not go, so the outbox retries it; see notifications/application/notify.ts.
  [EVENTS.ShiftInvited]: async (payload) => notifyShiftInvited(payload),
  [EVENTS.ShiftAccepted]: async (payload) => notifyShiftAccepted(payload),
  [EVENTS.CredentialVerified]: async (payload) => notifyCredentialVerified(payload),
  [EVENTS.CredentialRejected]: async (payload) => notifyCredentialRejected(payload),
  [EVENTS.CredentialInfoRequested]: async (payload) => notifyCredentialInfoRequested(payload),
  [EVENTS.CredentialExpired]: async (payload) => notifyCredentialExpired(payload),
  [EVENTS.FacilityVerified]: async (payload) => notifyFacilityVerified(payload),
  [EVENTS.SuggestionAnswered]: async (payload) => notifySuggestionAnswered(payload),
  [EVENTS.TimesheetSubmitted]: async (payload) => notifyTimesheetSubmitted(payload),
  [EVENTS.TimesheetApproved]: async (payload) => {
    // The assignment first, so a failure to tell anyone cannot leave an approved shift not completed
    // (TIM-04); both are safe to repeat.
    await completeAssignmentOfApprovedSheet(payload);
    await notifyTimesheetApproved(payload);
  },
  [EVENTS.TimesheetRecalculated]: async (payload) => notifyTimesheetRecalculated(payload),
  [EVENTS.DisputeOpened]: async (payload) => notifyDisputeOpened(payload),

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

  // Severe and fatal incidents are put in front of the people who can act on
  // them; the event used to wait in a queue until somebody opened the page.
  [EVENTS.ClinicalIncidentReported]: async (payload) => {
    await notifyIncidentReported(payload);
  },

  // What happens to a dispute after it is opened (opening is above), told to the people in it.
  [EVENTS.DisputeUnderReview]: (payload) => notifyDisputeStage('dispute.under_review', payload),
  [EVENTS.DisputeResolved]: (payload) => notifyDisputeStage('dispute.resolved', payload),
  [EVENTS.DisputeWithdrawn]: (payload) => notifyDisputeStage('dispute.withdrawn', payload),

  // Hours sent back, bills and payments: told to whoever has to act on them or is owed them.
  [EVENTS.TimesheetRejected]: (payload) => notifyTimesheetRejected(payload),
  [EVENTS.StaffAccessRemoved]: (payload) => notifyStaffAccessRemoved(payload),
  [EVENTS.StaffInvited]: (payload) => notifyStaffInvited(payload),
  [EVENTS.StaffInvitationAnswered]: (payload) => notifyStaffInvitationAnswered(payload),
  [EVENTS.InvoiceIssued]: (payload) => notifyInvoiceIssued(payload),
  [EVENTS.PayoutSettled]: (payload) => notifyPayoutSettled(payload),
  [EVENTS.PayoutAccountSubmitted]: (payload) => notifyPayoutAccountSubmitted(payload),
  [EVENTS.PayoutAccountReviewed]: (payload) => notifyPayoutAccountReviewed(payload),

  [EVENTS.PractitionerRegistered]: async (payload) => {
    // No welcome text is sent: the sign-up request sent the one-time code already (see
    // docs/notification-matrix.md for what each event tells, and what it does not).
    logger.info('practitioner registered', { userId: String(payload.userId ?? '') });
    await grantPractitionerRoleOnRegistration(String(payload.userId ?? ''));

    // Step 5.6 screens at registration as well as on a schedule: a name
    // already on the list should never reach a first shift, and waiting
    // for tonight's sweep is a window nobody needs to leave open.
    await screenPractitioner(String(payload.userId ?? ''));
  },
};
