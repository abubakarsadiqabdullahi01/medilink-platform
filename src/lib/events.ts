/**
 * The domain event vocabulary from Section 8.2 of the specification.
 * Modules react to these rather than reading one another's tables.
 */
export const EVENTS = {
  PractitionerRegistered: 'practitioner.registered',
  CredentialSubmitted: 'credential.submitted',
  CredentialVerified: 'credential.verified',
  CredentialExpired: 'credential.expired',
  FacilityVerified: 'facility.verified',
  ServiceRequestPublished: 'service_request.published',
  ShiftInvited: 'shift.invited',
  ShiftAccepted: 'shift.accepted',
  AssignmentConfirmed: 'assignment.confirmed',
  ShiftStarted: 'shift.started',
  ShiftCompleted: 'shift.completed',
  TimesheetSubmitted: 'timesheet.submitted',
  TimesheetApproved: 'timesheet.approved',
  InvoiceCreated: 'invoice.created',
  PaymentCompleted: 'payment.completed',
  PayoutSettled: 'payout.settled',
  NoShowRecorded: 'no_show.recorded',
  SanctionApplied: 'sanction.applied',
  DisputeOpened: 'dispute.opened',
  ClinicalIncidentReported: 'clinical_incident.reported',
} as const;

export type EventType = (typeof EVENTS)[keyof typeof EVENTS];
