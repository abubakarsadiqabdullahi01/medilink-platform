import { prisma } from '@/lib/db';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from '@/lib/authz/permissions';
import { createServiceRequest } from '@/modules/service-requests/application/request';
import { buildBookingWorld, eligiblePractitioner } from './booking-world';
import { createCredentialType, createUser, ensureRole, grant } from './fixtures';

/**
 * Two hospitals, side by side, each with one of everything a route can take the
 * identifier of — for proving that a caller from one cannot reach the other's.
 *
 * Built from real rules where that is cheap (a verified facility, an eligible
 * practitioner, real grants with the real permission bundles) and from rows
 * where the workflow would only be getting in the way: a dispute does not need
 * a hearing to exist, it needs to *exist*, so a refused request has something
 * it could have touched.
 *
 * Symmetric on purpose. Every attack is "a caller from one tenant, the other
 * tenant's thing", and building both sides the same way means either one can
 * be the attacker without a second set of fixtures.
 */

export interface Tenant {
  label: string;
  facilityId: string;
  facilityName: string;

  /** The registrant: `facility_owner`, the most a hospital can hold over itself. */
  ownerId: string;
  practitionerId: string;
  practitionerName: string;
  practitionerPhone: string;
  /** A second practitioner, who holds an open invitation and a no-show. */
  inviteeId: string;

  /** Published, two places, with one confirmed booking and one open invitation. */
  futureRequestId: string;
  draftRequestId: string;
  futureAssignmentId: string;
  invitationId: string;
  matchRunId: string;

  /** A finished shift: attendance submitted, a timesheet, and the disagreement over it. */
  pastAssignmentId: string;
  timesheetId: string;
  disputeId: string;
  evidenceId: string;
  incidentId: string;

  /** The invitee's shift, its hours decided and no dispute open: one that *can* be disputed. */
  decidedAssignmentId: string;

  /** A shift nobody turned up to, waiting for somebody to say whose fault it was. */
  noShowAssignmentId: string;
  excusalId: string;

  invoiceId: string;
  payoutId: string;

  /** A colleague's access to this hospital, which an owner may revoke. */
  staffGrantId: string;
  /** Another colleague's, for the route that changes a role: the revoke above ends its grant first. */
  roleChangeGrantId: string;
  /** Somebody this hospital has invited to work for it, and the number the invitation waits on. */
  staffInviteeId: string;
  staffInviteePhone: string;
  staffInvitationId: string;
  /** A second waiting invitation, for the route that cancels one: answering the first ends it. */
  cancelStaffInvitationId: string;
  credentialId: string;
  /** A credential type nobody has submitted yet, for a fresh submission. */
  docTypeId: string;
  /** Their submission that compliance sent back asking for a better document. */
  queriedCredentialId: string;
  /** A document they uploaded and own: the key an outsider must not be able to submit as theirs. */
  documentKey: string;
  slotId: string;
  blockId: string;
  suggestionId: string;
  dataRequestId: string;
}

export interface TenantWorld {
  a: Tenant;
  b: Tenant;
  /** Holds every permission, over the whole platform. The control for platform routes. */
  platformAdminId: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Numbers for invitations nobody has answered, so a person cannot be mistaken for the one invited. */
let nobodyHoldsThisNumber = 0;

async function buildTenant(label: string): Promise<Tenant> {
  const world = await buildBookingWorld({ headcount: 2 });
  const facility = await prisma.facility.update({
    where: { id: world.facilityId },
    data: { name: `${label} Memorial Hospital` },
  });
  const ownerId = facility.representativeUserId;

  const practitionerName = `${label} Practitioner`;
  const practitioner = await eligiblePractitioner(world, practitionerName);
  const invitee = await eligiblePractitioner(world, `${label} Invitee`);
  for (const user of [practitioner, invitee]) {
    await grant({
      userId: user.id,
      roleKey: 'practitioner',
      permissions: ROLE_PERMISSIONS.practitioner ?? [],
      scopeType: 'SELF',
      scopeId: user.id,
    });
  }

  // A colleague of the owner's, whose access is the thing the revoke route is about.
  const colleague = await createUser({ fullName: `${label} Colleague` });
  const staffGrant = await grant({
    userId: colleague.id,
    roleKey: 'facility_administrator',
    permissions: ROLE_PERMISSIONS.facility_administrator ?? [],
    scopeType: 'FACILITY',
    scopeId: facility.id,
  });
  const secondColleague = await createUser({ fullName: `${label} Second Colleague` });
  const roleChangeGrant = await grant({
    userId: secondColleague.id,
    roleKey: 'facility_administrator',
    permissions: ROLE_PERMISSIONS.facility_administrator ?? [],
    scopeType: 'FACILITY',
    scopeId: facility.id,
  });

  // A person this hospital has invited to work for it, who has verified the number it was sent to,
  // and a second invitation to a number nobody holds yet.
  const staffInvitee = await createUser({ fullName: `${label} Staff Invitee` });
  const staffInvitation = await prisma.staffInvitation.create({
    data: {
      facilityId: facility.id,
      phone: staffInvitee.phone,
      roleKey: 'facility_administrator',
      invitedBy: ownerId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  const cancelStaffInvitation = await prisma.staffInvitation.create({
    data: {
      facilityId: facility.id,
      phone: `+23480666${String((nobodyHoldsThisNumber += 1)).padStart(5, '0')}`,
      roleKey: 'facility_administrator',
      invitedBy: ownerId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const now = Date.now();
  const futureStarts = new Date(now + 5 * DAY);
  const futureEnds = new Date(futureStarts.getTime() + 8 * 60 * 60 * 1000);

  const draft = await createServiceRequest({
    facilityId: facility.id,
    professionalCategoryId: world.categoryId,
    shiftType: 'DAY',
    startsAt: new Date(now + 9 * DAY),
    endsAt: new Date(now + 9 * DAY + 8 * 60 * 60 * 1000),
    headcount: 1,
    hourlyRateKobo: 500_000,
    urgency: 'ROUTINE',
    cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
    actorId: ownerId,
  });

  const futureAssignment = await prisma.assignment.create({
    data: {
      serviceRequestId: world.requestId,
      userId: practitioner.id,
      facilityId: facility.id,
      startsAt: futureStarts,
      endsAt: futureEnds,
      status: 'CONFIRMED',
      confirmedBy: ownerId,
    },
  });
  await prisma.attendanceRecord.create({
    data: { assignmentId: futureAssignment.id, status: 'NOT_STARTED' },
  });

  const invitation = await prisma.invitation.create({
    data: {
      serviceRequestId: world.requestId,
      userId: invitee.id,
      status: 'INVITED',
      expiresAt: new Date(now + 3 * DAY),
      invitedBy: ownerId,
    },
  });
  const matchRun = await prisma.matchRun.create({
    data: {
      serviceRequestId: world.requestId,
      runBy: ownerId,
      consideredCount: 2,
      rankedCount: 1,
      weights: {},
    },
  });

  // The finished shift.
  const pastStarts = new Date(now - 3 * DAY);
  const pastEnds = new Date(pastStarts.getTime() + 8 * 60 * 60 * 1000);
  const pastRequest = await prisma.serviceRequest.create({
    data: {
      facilityId: facility.id,
      professionalCategoryId: world.categoryId,
      shiftType: 'DAY',
      startsAt: pastStarts,
      endsAt: pastEnds,
      headcount: 2,
      hourlyRateKobo: 500_000,
      cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
      status: 'FILLED',
      createdBy: ownerId,
      publishedBy: ownerId,
      publishedAt: new Date(now - 10 * DAY),
    },
  });
  const pastAssignment = await prisma.assignment.create({
    data: {
      serviceRequestId: pastRequest.id,
      userId: practitioner.id,
      facilityId: facility.id,
      startsAt: pastStarts,
      endsAt: pastEnds,
      status: 'COMPLETED',
      confirmedBy: ownerId,
    },
  });
  const attendance = await prisma.attendanceRecord.create({
    data: {
      assignmentId: pastAssignment.id,
      status: 'SUBMITTED',
      checkedInAt: pastStarts,
      checkedOutAt: pastEnds,
      submittedAt: pastEnds,
      submittedBy: practitioner.id,
    },
  });
  const timesheet = await prisma.timesheet.create({
    data: {
      attendanceRecordId: attendance.id,
      workedMinutes: 480,
      breakMinutes: 0,
      billableMinutes: 480,
      nightMinutes: 0,
      overtimeMinutes: 0,
      holidayMinutes: 0,
      hourlyRateKobo: 500_000,
      amountKobo: 4_000_000,
    },
  });
  const dispute = await prisma.dispute.create({
    data: {
      assignmentId: pastAssignment.id,
      raisedBy: practitioner.id,
      raisedParty: 'PRACTITIONER',
      category: 'HOURS',
      reason: `${label}: the hours on the timesheet are not the hours I worked.`,
      respondBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  const evidence = await prisma.disputeEvidence.create({
    data: {
      disputeId: dispute.id,
      objectKey: `disputes/${dispute.id}/rota.pdf`,
      attachedBy: practitioner.id,
      note: `${label} evidence note`,
    },
  });
  const incident = await prisma.clinicalIncident.create({
    data: {
      facilityId: facility.id,
      assignmentId: pastAssignment.id,
      subjectUserId: practitioner.id,
      reportedBy: ownerId,
      occurredAt: new Date(now - 3 * DAY),
      severity: 'MINOR',
      category: 'DOCUMENTATION',
      summary: `${label}: a drug chart was signed late during the shift.`,
    },
  });

  // The shift nobody turned up to: the invitee's, with an excusal asking to be forgiven.
  const noShow = await prisma.assignment.create({
    data: {
      serviceRequestId: pastRequest.id,
      userId: invitee.id,
      facilityId: facility.id,
      startsAt: pastStarts,
      endsAt: pastEnds,
      status: 'NO_SHOW',
      confirmedBy: ownerId,
    },
  });
  await prisma.unhonouredAssignment.create({
    data: { assignmentId: noShow.id, shiftEndedAt: pastEnds },
  });
  const excusal = await prisma.excusal.create({
    data: {
      assignmentId: noShow.id,
      requestedBy: invitee.id,
      reason: `${label}: I was in hospital that morning.`,
    },
  });

  // A shift whose hours have been decided and which nobody has disputed: the
  // state in which a dispute *can* be opened, so that when an outsider is
  // refused it is for who they are and not for what state the shift is in.
  const decidedStarts = new Date(now - 2 * DAY);
  const decidedEnds = new Date(decidedStarts.getTime() + 8 * 60 * 60 * 1000);
  const decidedRequest = await prisma.serviceRequest.create({
    data: {
      facilityId: facility.id,
      professionalCategoryId: world.categoryId,
      shiftType: 'DAY',
      startsAt: decidedStarts,
      endsAt: decidedEnds,
      headcount: 1,
      hourlyRateKobo: 500_000,
      cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
      status: 'FILLED',
      createdBy: ownerId,
      publishedBy: ownerId,
      publishedAt: new Date(now - 10 * DAY),
    },
  });
  const decidedAssignment = await prisma.assignment.create({
    data: {
      serviceRequestId: decidedRequest.id,
      userId: invitee.id,
      facilityId: facility.id,
      startsAt: decidedStarts,
      endsAt: decidedEnds,
      status: 'COMPLETED',
      confirmedBy: ownerId,
    },
  });
  await prisma.attendanceRecord.create({
    data: {
      assignmentId: decidedAssignment.id,
      status: 'APPROVED',
      checkedInAt: decidedStarts,
      checkedOutAt: decidedEnds,
      submittedAt: decidedEnds,
      submittedBy: invitee.id,
      reviewedAt: new Date(now - HOUR),
      reviewedBy: ownerId,
    },
  });

  const invoice = await prisma.invoice.create({
    data: {
      facilityId: facility.id,
      number: `INV-${label.toUpperCase()}-0001`,
      periodStart: new Date(now - 30 * DAY),
      periodEnd: new Date(now - 1 * DAY),
      grossKobo: 4_000_000,
      status: 'DRAFT',
      createdBy: ownerId,
    },
  });
  const payout = await prisma.payout.create({
    data: { practitionerId: practitioner.id, amountKobo: 3_000_000, status: 'PREPARED' },
  });

  // Their own PENDING submission, of a second type so it is not the one eligibility rests on.
  const otherType = await createCredentialType({ verificationMethod: 'document_review' });
  const credential = await prisma.credentialSubmission.create({
    data: {
      userId: practitioner.id,
      credentialTypeId: otherType.id,
      status: 'PENDING',
      referenceNumber: `${label.toUpperCase()}-REF-1`,
      documentObjectKey: `credentials/${practitioner.id}/licence.pdf`,
    },
  });

  // A fresh type to submit against, and a submission that has been sent back for
  // a better document (the state in which a document can be supplied again).
  const docType = await createCredentialType({ verificationMethod: 'document_review' });
  const queriedType = await createCredentialType({ verificationMethod: 'document_review' });
  const queried = await prisma.credentialSubmission.create({
    data: {
      userId: practitioner.id,
      credentialTypeId: queriedType.id,
      status: 'MORE_INFO_REQUESTED',
      referenceNumber: `${label.toUpperCase()}-REF-2`,
      reviewNotes: 'The photograph is not clear enough to read.',
    },
  });
  // What an upload leaves behind: the practitioner's own stored object.
  await prisma.storedObject.create({
    data: {
      bucket: 'test',
      objectKey: credential.documentObjectKey as string,
      contentType: 'application/pdf',
      sizeBytes: 2048,
      purpose: 'credential_document',
      ownerUserId: practitioner.id,
      uploadedAt: new Date(),
    },
  });

  const slot = await prisma.availabilitySlot.create({
    data: {
      userId: practitioner.id,
      kind: 'RECURRING_WEEKLY',
      dayOfWeek: 1,
      startMinute: 8 * 60,
      endMinute: 18 * 60,
    },
  });
  const block = await prisma.blockedPeriod.create({
    data: {
      userId: practitioner.id,
      startsAt: new Date(now + 20 * DAY),
      endsAt: new Date(now + 21 * DAY),
      reason: `${label} annual leave`,
    },
  });
  const suggestion = await prisma.suggestion.create({
    data: {
      raisedBy: practitioner.id,
      area: 'OTHER',
      body: `${label}: it would help if the roster showed the ward as well.`,
    },
  });
  const dataRequest = await prisma.dataSubjectRequest.create({
    data: {
      userId: practitioner.id,
      kind: 'ACCESS',
      dueBy: new Date(now + 30 * DAY),
      detail: `${label}: please send me everything you hold on me.`,
    },
  });

  return {
    label,
    facilityId: facility.id,
    facilityName: facility.name,
    ownerId,
    practitionerId: practitioner.id,
    practitionerName,
    practitionerPhone: practitioner.phone,
    inviteeId: invitee.id,
    futureRequestId: world.requestId,
    draftRequestId: draft.id,
    futureAssignmentId: futureAssignment.id,
    invitationId: invitation.id,
    matchRunId: matchRun.id,
    pastAssignmentId: pastAssignment.id,
    timesheetId: timesheet.id,
    disputeId: dispute.id,
    evidenceId: evidence.id,
    incidentId: incident.id,
    decidedAssignmentId: decidedAssignment.id,
    noShowAssignmentId: noShow.id,
    excusalId: excusal.id,
    invoiceId: invoice.id,
    payoutId: payout.id,
    staffGrantId: staffGrant.id,
    roleChangeGrantId: roleChangeGrant.id,
    staffInviteeId: staffInvitee.id,
    staffInviteePhone: staffInvitee.phone,
    staffInvitationId: staffInvitation.id,
    cancelStaffInvitationId: cancelStaffInvitation.id,
    credentialId: credential.id,
    docTypeId: docType.id,
    queriedCredentialId: queried.id,
    documentKey: credential.documentObjectKey as string,
    slotId: slot.id,
    blockId: block.id,
    suggestionId: suggestion.id,
    dataRequestId: dataRequest.id,
  };
}

export async function buildTenantWorld(): Promise<TenantWorld> {
  // The roles a hospital owner, a practitioner and the platform are made of, with
  // the real bundles: a refusal proved against a role holding too little would
  // prove nothing about the roles people actually have.
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);
  await ensureRole('facility_administrator', ROLE_PERMISSIONS.facility_administrator ?? []);
  await ensureRole('practitioner', ROLE_PERMISSIONS.practitioner ?? []);

  const a = await buildTenant('Alpha');
  const b = await buildTenant('Bravo');

  const platformAdmin = await createUser({ fullName: 'Platform Administrator' });
  await grant({
    userId: platformAdmin.id,
    roleKey: 'super_administrator',
    permissions: Object.keys(PERMISSIONS) as Permission[],
    scopeType: 'PLATFORM',
  });

  return { a, b, platformAdminId: platformAdmin.id };
}
