import { prisma } from '@/lib/db';
import { maskPhone } from '@/lib/phone';
import { DataSubjectErrors } from './data-subject';
import { EXCLUSIONS, EXPORT_SECTIONS } from '../domain/export-coverage';

/**
 * Everything the platform holds about one person (M17-03, AUD-07).
 *
 * Access and portability are answered by one function rather than by somebody
 * assembling a spreadsheet from a dozen tables, because the version assembled by
 * hand is the one that quietly omits something. Every table the data inventory
 * lists as being about a person is either a section here or an entry in
 * `EXCLUSIONS` with the reason, and a test fails when the inventory and this
 * disagree (`export-coverage.ts`).
 *
 * Three rules, each one a way a subject access request goes wrong:
 *
 *  1. **Named columns, never a whole row.** Every query says which columns it
 *     returns, so a column added to a table next year is not disclosed by
 *     default. A whole-row `findMany` is how a token hash, a push token and the
 *     names of two staff members came to be in a person's download.
 *  2. **Only the subject's own.** Everything is keyed to `userId`, and anything
 *     on those rows that names somebody else — who confirmed a booking, who
 *     decided a dispute, who attached a file — is reduced to "you" or "someone
 *     else". Not a staff member's account id; the person is owed what was done to
 *     them, not a directory of whoever did it.
 *  3. **Nothing that opens a door.** No hash of a code or session token, no push
 *     token, no storage key, no sealed number. They are not the person's data,
 *     they are the means of acting as them.
 *
 * Open to every signed-in person, not just practitioners: a hospital's
 * scheduler has an account, sessions, messages and a record of what they did,
 * and the right does not depend on the job (AUD-08).
 */

type Who = 'you' | 'someone else';

/** The person's own part in something somebody else did, without naming the somebody. */
function by(userId: string, actorId: string | null | undefined): Who | null {
  if (actorId === null || actorId === undefined) return null;
  return actorId === userId ? 'you' : 'someone else';
}

const OWN_SHIFTS = (userId: string) => ({ assignment: { userId } });

export async function exportSubjectData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      status: true,
      createdAt: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      lastLoginAt: true,
    },
  });
  if (!user) throw DataSubjectErrors.notFound();

  const loginIdentifiers = [user.phone, user.email].filter((value): value is string => Boolean(value));

  const [
    profile,
    identity,
    registrations,
    credentials,
    slots,
    blocks,
    invitations,
    assignments,
    assignmentHistory,
    matchingScores,
    attendance,
    timesheets,
    invoiceLines,
    payouts,
    payoutAccounts,
  ] = await Promise.all([
    prisma.practitionerProfile.findUnique({
      where: { userId },
      select: {
        professionalCategoryId: true,
        specialtyId: true,
        yearsOfExperience: true,
        bio: true,
        photoObjectKey: true,
        homeStateId: true,
        homeLgaId: true,
        travelPreference: true,
        submittedForReviewAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    // The NIN itself is never returned: only a keyed digest and the last four
    // are stored, and the digest is not the subject's to receive.
    prisma.identityVerification.findUnique({
      where: { userId },
      select: { ninLast4: true, nameMatch: true, method: true, verifiedAt: true },
    }),
    prisma.professionalRegistration.findMany({
      where: { userId },
      select: {
        regulator: true,
        folioNumber: true,
        practiceType: true,
        registrationStatus: true,
        location: true,
        evidenceRetrievedAt: true,
        expiresAt: true,
        source: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.credentialSubmission.findMany({
      where: { userId },
      select: {
        status: true,
        referenceNumber: true,
        documentObjectKey: true,
        reviewedAt: true,
        reviewNotes: true,
        expiresAt: true,
        documentExpiresOn: true,
        createdAt: true,
        deletedAt: true,
        credentialType: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.availabilitySlot.findMany({
      where: { userId },
      select: {
        kind: true,
        dayOfWeek: true,
        startMinute: true,
        endMinute: true,
        effectiveFrom: true,
        effectiveUntil: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
        deletedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.blockedPeriod.findMany({
      where: { userId },
      select: { startsAt: true, endsAt: true, reason: true, createdAt: true, deletedAt: true },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { userId },
      select: {
        id: true,
        serviceRequestId: true,
        status: true,
        expiresAt: true,
        respondedAt: true,
        declineReason: true,
        termsAccepted: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.assignment.findMany({
      where: { userId },
      select: {
        id: true,
        serviceRequestId: true,
        facilityId: true,
        startsAt: true,
        endsAt: true,
        status: true,
        rateTerms: true,
        createdAt: true,
      },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.assignmentStatusHistory.findMany({
      where: OWN_SHIFTS(userId),
      select: {
        assignmentId: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        actorId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    // The person's own place in a hospital's search, and nobody else's: the run
    // belongs to the hospital and lists everyone it looked at.
    prisma.matchCandidate.findMany({
      where: { userId },
      select: { rank: true, score: true, factors: true, exclusions: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.attendanceRecord.findMany({
      where: OWN_SHIFTS(userId),
      select: {
        assignmentId: true,
        status: true,
        checkedInAt: true,
        checkedOutAt: true,
        breakMinutes: true,
        submittedAt: true,
        reviewedAt: true,
        reviewNotes: true,
        createdAt: true,
        events: {
          select: {
            kind: true,
            method: true,
            occurredAt: true,
            recordedAt: true,
            reason: true,
            deviceLabel: true,
            actorId: true,
          },
          orderBy: { recordedAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.timesheet.findMany({
      where: { attendanceRecord: OWN_SHIFTS(userId) },
      select: {
        attendanceRecord: { select: { assignmentId: true } },
        workedMinutes: true,
        breakMinutes: true,
        billableMinutes: true,
        nightMinutes: true,
        overtimeMinutes: true,
        holidayMinutes: true,
        onCallMinutes: true,
        hourlyRateKobo: true,
        amountKobo: true,
        currency: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
        revisions: {
          select: { revision: true, previous: true, reason: true, actorId: true, createdAt: true },
          orderBy: { revision: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    // The line for the person's own shift: what it came to and how it was priced.
    // The invoice is the hospital's, so only its number and where it stands.
    prisma.invoiceLine.findMany({
      where: { practitionerId: userId },
      select: {
        assignmentId: true,
        hourlyRateKobo: true,
        ordinaryMinutes: true,
        nightMinutes: true,
        holidayMinutes: true,
        overtimeMinutes: true,
        onCallMinutes: true,
        baseKobo: true,
        premiumKobo: true,
        amountKobo: true,
        createdAt: true,
        voidedAt: true,
        invoice: { select: { number: true, status: true, issuedAt: true, paidAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payout.findMany({
      where: { practitionerId: userId },
      select: {
        id: true,
        amountKobo: true,
        currency: true,
        status: true,
        providerReference: true,
        failureReason: true,
        releasedAt: true,
        settledAt: true,
        paidOn: true,
        accountId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    // Never the sealed number or the hash of it: the last four digits, which is what
    // the person sees of their own account anywhere in the product.
    prisma.payoutAccount.findMany({
      where: { userId },
      select: {
        bankName: true,
        accountName: true,
        accountLast4: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
        reviewNote: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const [
    devices,
    sessions,
    roles,
    signInAttempts,
    screening,
    files,
    disputes,
    incidents,
    suspensions,
    excusals,
    unhonoured,
    consents,
    acceptances,
    requests,
    notifications,
    suggestions,
    securityEvents,
    staffInvitations,
  ] = await Promise.all([
    // The label and platform, never the push token: that is the means of sending
    // a notification to the phone, not a fact about the person.
    prisma.device.findMany({
      where: { userId },
      select: { id: true, label: true, platform: true, lastSeenAt: true, trustedAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    // Never the hash of the token: whoever holds it can be the person.
    prisma.session.findMany({
      where: { userId },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        stepUpAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.userRole.findMany({
      where: { userId },
      select: {
        scopeType: true,
        scopeId: true,
        createdAt: true,
        revokedAt: true,
        role: { select: { key: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    // Matched on the number or address typed as well as on the account, because
    // a wrong guess at somebody's number has no account to hang from. No network
    // address: for a failed attempt it is the address of whoever typed it.
    prisma.loginAttempt.findMany({
      where: {
        OR: [{ userId }, ...(loginIdentifiers.length > 0 ? [{ identifier: { in: loginIdentifiers } }] : [])],
      },
      select: { succeeded: true, reason: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.screeningResult.findUnique({
      where: { userId },
      select: {
        status: true,
        matchedOn: true,
        screenedAt: true,
        clearedBy: true,
        notes: true,
        createdAt: true,
      },
    }),
    prisma.storedObject.findMany({
      where: { ownerUserId: userId, deletedAt: null },
      select: { id: true, purpose: true, contentType: true, sizeBytes: true, uploadedAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    // A case the person raised, and a case over a shift of theirs that somebody
    // else raised: both are about them, and either party sees the whole case in
    // the app, resolution notes included.
    prisma.dispute.findMany({
      where: { OR: [{ raisedBy: userId }, { assignment: { userId } }] },
      select: {
        id: true,
        assignmentId: true,
        raisedBy: true,
        raisedParty: true,
        category: true,
        reason: true,
        status: true,
        outcome: true,
        decisionReason: true,
        resolvedAt: true,
        resolutionNotes: true,
        withdrawnAt: true,
        // By when the other side was asked to reply, and what they wrote (M14-03).
        respondBy: true,
        responseNote: true,
        respondedAt: true,
        respondedBy: true,
        createdAt: true,
        evidence: {
          select: { id: true, attachedBy: true, note: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    // What the person reported, in their words. A report that names them is not
    // here (see `incidentsAboutYou`), and what compliance wrote in closing the
    // ones they did report is not either: it may discuss somebody else.
    prisma.clinicalIncident.findMany({
      where: { reportedBy: userId },
      select: {
        id: true,
        facilityId: true,
        assignmentId: true,
        subjectUserId: true,
        occurredAt: true,
        reportedAt: true,
        severity: true,
        category: true,
        summary: true,
        status: true,
        outcome: true,
        attachments: {
          where: { attachedBy: userId },
          select: { id: true, note: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { reportedAt: 'asc' },
    }),
    prisma.accountSuspension.findMany({
      where: { userId },
      select: {
        reason: true,
        suspendedAt: true,
        incidentId: true,
        liftedAt: true,
        liftedReason: true,
      },
      orderBy: { suspendedAt: 'asc' },
    }),
    prisma.excusal.findMany({
      where: OWN_SHIFTS(userId),
      select: {
        assignmentId: true,
        requestedBy: true,
        reason: true,
        status: true,
        decidedAt: true,
        decisionNotes: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.unhonouredAssignment.findMany({
      where: OWN_SHIFTS(userId),
      select: {
        assignmentId: true,
        shiftEndedAt: true,
        detectedAt: true,
        status: true,
        fault: true,
        decidedAt: true,
        reason: true,
      },
      orderBy: { detectedAt: 'asc' },
    }),
    prisma.consentRecord.findMany({
      where: { userId },
      select: {
        purpose: true,
        granted: true,
        lawfulBasis: true,
        grantedAt: true,
        withdrawnAt: true,
        note: true,
      },
      orderBy: { grantedAt: 'asc' },
    }),
    prisma.agreementAcceptance.findMany({
      where: { userId },
      select: { acceptedAt: true, version: { select: { identifier: true, title: true } } },
      orderBy: { acceptedAt: 'asc' },
    }),
    prisma.dataSubjectRequest.findMany({
      where: { userId },
      select: {
        id: true,
        kind: true,
        status: true,
        detail: true,
        outcome: true,
        receivedAt: true,
        dueBy: true,
        completedAt: true,
      },
      orderBy: { receivedAt: 'asc' },
    }),
    // Every text and notice sent, as the person was told it. The number is already
    // masked in the table, and what a message was "about" is a kind and a type, not
    // the id of a record that could belong to somebody else.
    prisma.notificationMessage.findMany({
      where: { userId },
      select: {
        channel: true,
        kind: true,
        recipient: true,
        body: true,
        relatedType: true,
        sentAt: true,
        failureReason: true,
        deliveryStatus: true,
        readAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.suggestion.findMany({
      where: { raisedBy: userId },
      select: { source: true, area: true, body: true, status: true, response: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    // What the person themselves looked at, and when. The `detail` is left out: it names
    // the record that was read, and that record may be somebody else's.
    prisma.securityEvent.findMany({
      where: { userId },
      select: { kind: true, severity: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    // Invitations to work for a facility that were sent to this number, and those this person sent.
    // The number of somebody they invited is shown masked: it is theirs, not this person's.
    prisma.staffInvitation.findMany({
      where: { OR: [{ phone: user.phone }, { invitedBy: userId }] },
      select: {
        phone: true,
        invitedBy: true,
        roleKey: true,
        status: true,
        expiresAt: true,
        respondedAt: true,
        createdAt: true,
        facility: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return {
    generatedAt: new Date(),
    // Said in the export itself, because somebody reading it will wonder
    // where the rest is.
    notIncluded: EXCLUSIONS,
    account: user,
    profile: profile
      ? (({ photoObjectKey, ...row }) => ({ ...row, hasPhoto: photoObjectKey !== null }))(profile)
      : null,
    identityVerification: identity,
    professionalRegistrations: registrations,
    credentials: credentials.map(({ documentObjectKey, credentialType, ...row }) => ({
      ...row,
      credentialType: credentialType.name,
      hasDocument: documentObjectKey !== null,
    })),
    availability: { slots, blocks },
    invitations,
    assignments,
    assignmentHistory: assignmentHistory.map(({ actorId, ...row }) => ({
      ...row,
      changedBy: by(userId, actorId),
    })),
    matchingScores,
    attendance: attendance.map((record) => ({
      ...record,
      events: record.events.map(({ actorId, ...event }) => ({ ...event, recordedBy: by(userId, actorId) })),
    })),
    timesheets: timesheets.map(({ attendanceRecord, revisions, ...sheet }) => ({
      assignmentId: attendanceRecord.assignmentId,
      ...sheet,
      revisions: revisions.map(({ actorId, ...revision }) => ({
        ...revision,
        changedBy: by(userId, actorId),
      })),
    })),
    invoiceLines: invoiceLines.map(({ invoice, ...line }) => ({
      ...line,
      invoiceNumber: invoice.number,
      invoiceStatus: invoice.status,
      invoiceIssuedAt: invoice.issuedAt,
      invoicePaidAt: invoice.paidAt,
    })),
    payouts,
    payoutAccounts,
    devices,
    sessions,
    roles: roles.map(({ role, ...grant }) => ({ ...grant, role: role.name, roleKey: role.key })),
    signInAttempts,
    screening: screening
      ? (({ clearedBy, ...row }) => ({ ...row, clearedByAReviewer: clearedBy !== null }))(screening)
      : null,
    files,
    disputes: disputes.map(({ raisedBy, respondedBy, evidence, ...row }) => ({
      ...row,
      raisedByYou: raisedBy === userId,
      // Who replied, as "you" or not; null when nobody has.
      respondedByYou: respondedBy === null ? null : respondedBy === userId,
      evidence: evidence.map(({ attachedBy, ...item }) => ({ ...item, attachedBy: by(userId, attachedBy) })),
    })),
    incidentsYouReported: incidents.map(({ subjectUserId, ...row }) => ({
      ...row,
      namedAPractitioner: subjectUserId !== null && subjectUserId !== userId,
    })),
    suspensions: suspensions.map(({ incidentId, ...row }) => ({
      ...row,
      followedAnIncidentReport: incidentId !== null,
    })),
    excusals: excusals.map(({ requestedBy, ...row }) => ({ ...row, requestedByYou: requestedBy === userId })),
    unhonouredShifts: unhonoured,
    consent: consents,
    agreementsAccepted: acceptances.map((row) => ({
      identifier: row.version.identifier,
      title: row.version.title,
      acceptedAt: row.acceptedAt,
    })),
    dataSubjectRequests: requests,
    notifications,
    suggestions,
    securityEvents,
    staffInvitations: staffInvitations.map(({ phone, invitedBy, facility, ...row }) => ({
      ...row,
      facility: facility.name,
      toYou: phone === user.phone,
      sentByYou: invitedBy === userId,
      // Masked: for an invitation sent to somebody else, the number is theirs.
      ...(phone === user.phone ? {} : { numberInvited: maskPhone(phone) }),
    })),
  };
}

/**
 * That an export was made, and by whom — not what was in it. A read of everything
 * held about a person is worth a line in the log of reads, the same as a read of a
 * credential or the audit trail, and the record is written before the data is returned,
 * so an export cannot be made that the log does not know of.
 */
export async function recordExportMade(input: { userId: string; correlationId: string }): Promise<void> {
  await prisma.securityEvent.create({
    data: {
      userId: input.userId,
      kind: 'data_subject.export_generated',
      severity: 'info',
      detail: { sections: EXPORT_SECTIONS.length, correlationId: input.correlationId },
    },
  });
}
