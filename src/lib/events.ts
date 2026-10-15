/**
 * The domain event vocabulary from Section 8.2 of the specification.
 * Modules react to these rather than reading one another's tables.
 */
export const EVENTS = {
  PractitionerRegistered: 'practitioner.registered',
  CredentialSubmitted: 'credential.submitted',
  CredentialVerified: 'credential.verified',
  CredentialRejected: 'credential.rejected',
  CredentialInfoRequested: 'credential.info_requested',
  CredentialExpired: 'credential.expired',
  FacilityVerified: 'facility.verified',
  ServiceRequestPublished: 'service_request.published',
  ShiftInvited: 'shift.invited',
  ShiftAccepted: 'shift.accepted',
  AssignmentConfirmed: 'assignment.confirmed',
  AssignmentCancelled: 'assignment.cancelled',
  ShiftStarted: 'shift.started',
  ShiftCompleted: 'shift.completed',
  TimesheetSubmitted: 'timesheet.submitted',
  TimesheetApproved: 'timesheet.approved',
  TimesheetRejected: 'timesheet.rejected',
  TimesheetRecalculated: 'timesheet.recalculated',
  InvoiceCreated: 'invoice.created',
  InvoiceIssued: 'invoice.issued',
  PaymentCompleted: 'payment.completed',
  PayoutSettled: 'payout.settled',
  PayoutAccountSubmitted: 'payout_account.submitted',
  PayoutAccountReviewed: 'payout_account.reviewed',
  NoShowRecorded: 'no_show.recorded',
  SanctionApplied: 'sanction.applied',
  DisputeOpened: 'dispute.opened',
  DisputeUnderReview: 'dispute.under_review',
  DisputeResolved: 'dispute.resolved',
  DisputeWithdrawn: 'dispute.withdrawn',
  ClinicalIncidentReported: 'clinical_incident.reported',
  SuggestionAnswered: 'suggestion.answered',
} as const;

export type EventType = (typeof EVENTS)[keyof typeof EVENTS];
