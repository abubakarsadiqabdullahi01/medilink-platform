import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import { amountOwed } from '@/modules/billing-settlement/application/payout';
import {
  BLOCKER_EXPLANATIONS,
  ERASURE_EXEMPT_REASON,
  dueDateFor,
  erasureBlockers,
  isOverdue,
  type RequestKind,
  type RequestStatusValue,
} from '../domain/consent';

/**
 * Data-subject rights, and the export that satisfies most of them.
 *
 * A right that exists only in a privacy notice is not a right. Access and
 * portability are answered by one function here rather than by somebody
 * assembling a spreadsheet from six tables, because the version assembled by
 * hand is the one that quietly omits something.
 */

export const DataSubjectErrors = {
  notFound: () => new HttpError('request_not_found', 'That request does not exist.', 404),
  outcomeRequired: () =>
    new HttpError(
      'outcome_required',
      'Say what was done. A request closed with no outcome answers nobody.',
      422,
    ),
  alreadyClosed: () =>
    new HttpError('request_already_closed', 'That request has already been answered.', 409),
  notWaiting: () =>
    new HttpError(
      'request_not_waiting',
      'Only a request still waiting can be picked up.',
      409,
    ),
  erasureMustBeCarriedOut: () =>
    new HttpError(
      'erasure_must_be_carried_out',
      'An erasure is completed by carrying it out, not by saying it was done. Use Erase, or refuse it with the reason.',
      409,
    ),
};

export interface RequestView {
  id: string;
  userId: string;
  kind: RequestKind;
  status: RequestStatusValue;
  detail: string | null;
  outcome: string | null;
  receivedAt: Date;
  dueBy: Date;
  completedAt: Date | null;
  overdue: boolean;
}

function toView(row: {
  id: string;
  userId: string;
  kind: string;
  status: string;
  detail: string | null;
  outcome: string | null;
  receivedAt: Date;
  dueBy: Date;
  completedAt: Date | null;
}): RequestView {
  const status = row.status as RequestStatusValue;
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as RequestKind,
    status,
    detail: row.detail,
    outcome: row.outcome,
    receivedAt: row.receivedAt,
    dueBy: row.dueBy,
    completedAt: row.completedAt,
    overdue: isOverdue({ dueBy: row.dueBy, status }),
  };
}

export async function raiseRequest(input: {
  userId: string;
  kind: RequestKind;
  detail?: string;
}): Promise<RequestView> {
  const receivedAt = new Date();

  const created = await prisma.$transaction(async (tx: Tx) => {
    const row = await tx.dataSubjectRequest.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        detail: input.detail,
        receivedAt,
        // Recorded at creation rather than computed on read, so shortening
        // the window later cannot retroactively make an old request late.
        dueBy: dueDateFor(receivedAt),
      },
    });

    await recordAudit(tx, {
      action: 'data_subject.request_raised',
      entityType: 'consent.data_subject_requests',
      entityId: row.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      // What the person wrote stays on the request, where erasure can reach it.
      after: { kind: input.kind, dueBy: row.dueBy, hasDetail: Boolean(input.detail?.trim()) },
    });

    return row;
  });

  return toView(created);
}

/**
 * Somebody has picked this up.
 *
 * `IN_PROGRESS` has been in the status enum since the module was written and
 * nothing ever set it, so the console's "In progress" tab was permanently
 * empty — a filter that can only ever return nothing, which is worse than no
 * filter because people try it once and stop trusting the rest.
 *
 * It is a work signal, not a legal one. **The statutory clock does not stop
 * here**: the Act gives a month from the day the request arrived, and
 * `dueBy` was fixed at creation for exactly that reason. What this changes is
 * that a colleague opening the queue can see the request is being handled
 * rather than starting it again — the same job the "Start reviewing" step
 * does on a dispute.
 *
 * Deliberately not required before answering. A simple access request
 * exported and answered in one sitting should not need somebody to click
 * "start" first; the transition exists for the ones that take days.
 */
export async function startRequest(input: {
  requestId: string;
  actorId: string;
}): Promise<RequestView> {
  const existing = await prisma.dataSubjectRequest.findUnique({ where: { id: input.requestId } });
  if (!existing) throw DataSubjectErrors.notFound();
  if (existing.status === 'COMPLETED' || existing.status === 'REFUSED') {
    throw DataSubjectErrors.alreadyClosed();
  }
  if (existing.status !== 'RECEIVED') throw DataSubjectErrors.notWaiting();

  const updated = await prisma.$transaction(async (tx: Tx) => {
    // Conditional on the status just read, so two officers opening the queue
    // at once cannot both claim it.
    const applied = await tx.dataSubjectRequest.updateMany({
      where: { id: input.requestId, status: 'RECEIVED' },
      data: { status: 'IN_PROGRESS', handledBy: input.actorId },
    });
    if (applied.count !== 1) throw DataSubjectErrors.notWaiting();

    const row = await tx.dataSubjectRequest.findUniqueOrThrow({ where: { id: input.requestId } });

    await recordAudit(tx, {
      action: 'data_subject.started',
      entityType: 'consent.data_subject_requests',
      entityId: row.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: row.userId,
      before: { status: existing.status },
      after: { status: row.status },
    });

    return row;
  });

  return toView(updated);
}

export async function closeRequest(input: {
  requestId: string;
  actorId: string;
  status: 'COMPLETED' | 'REFUSED';
  outcome: string;
}): Promise<RequestView> {
  const existing = await prisma.dataSubjectRequest.findUnique({ where: { id: input.requestId } });
  if (!existing) throw DataSubjectErrors.notFound();
  if (existing.status === 'COMPLETED' || existing.status === 'REFUSED') {
    throw DataSubjectErrors.alreadyClosed();
  }
  // A refusal is a lawful outcome and has to be recorded as carefully as a
  // grant — more so, because it is the one somebody appeals.
  if (!input.outcome?.trim()) throw DataSubjectErrors.outcomeRequired();
  // Closing an erasure as done recorded words and deleted nothing (AUD-01).
  // Carrying it out closes it; only a refusal is closed by hand.
  if (existing.kind === 'ERASURE' && input.status === 'COMPLETED') {
    throw DataSubjectErrors.erasureMustBeCarriedOut();
  }

  const updated = await prisma.$transaction(async (tx: Tx) => {
    const row = await tx.dataSubjectRequest.update({
      where: { id: input.requestId },
      data: {
        status: input.status,
        outcome: input.outcome,
        completedAt: new Date(),
        handledBy: input.actorId,
      },
    });

    await recordAudit(tx, {
      action: input.status === 'COMPLETED' ? 'data_subject.completed' : 'data_subject.refused',
      entityType: 'consent.data_subject_requests',
      entityId: row.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: row.userId,
      reason: input.outcome,
      before: { status: existing.status },
      after: { status: row.status },
    });

    return row;
  });

  return toView(updated);
}

export async function listRequests(status?: RequestStatusValue): Promise<RequestView[]> {
  const rows = await prisma.dataSubjectRequest.findMany({
    where: status ? { status } : {},
    // Oldest first: the one closest to its deadline is the one to work.
    orderBy: { dueBy: 'asc' },
  });
  return rows.map(toView);
}

/**
 * The compliance queue, with the subject named and paged.
 *
 * The screen showed `67ddc9b6` under "Subject". A data-subject request is a
 * person exercising a right over their own record, and answering one without
 * knowing whose record it is cannot be done — an officer would have to look
 * the uuid up elsewhere to write the reply the Act requires.
 *
 * Ordering stays by deadline rather than arrival, which is the queue's whole
 * argument: the Act gives a month, so the one closest to running out is the
 * one to work, not the one that came in first.
 */
export interface RequestQueueRow extends RequestView {
  subjectName: string;
  subjectPhone: string;
}

export interface RequestQueuePage {
  requests: RequestQueueRow[];
  nextCursor: string | null;
}

export interface ListRequestsQuery {
  status?: RequestStatusValue;
  kind?: RequestKind;
  /** Matches the subject's name or phone number. */
  search?: string;
  limit: number;
  cursor?: string;
}

export async function listRequestQueue(query: ListRequestsQuery): Promise<RequestQueuePage> {
  const where: Prisma.DataSubjectRequestWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.kind) where.kind = query.kind;

  if (query.search) {
    const search = query.search.trim();
    where.user = {
      OR: [
        { fullName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ],
    };
  }

  const rows = await prisma.dataSubjectRequest.findMany({
    where,
    orderBy: [{ dueBy: 'asc' }, { id: 'asc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: { user: { select: { fullName: true, phone: true } } },
  });

  const page = rows.slice(0, query.limit);

  const requests = page.map((row) => ({
    ...toView(row),
    subjectName: row.user.fullName,
    subjectPhone: row.user.phone,
  }));

  return {
    requests,
    nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function listOwnRequests(userId: string): Promise<RequestView[]> {
  const rows = await prisma.dataSubjectRequest.findMany({
    where: { userId },
    orderBy: { receivedAt: 'desc' },
  });
  return rows.map(toView);
}

/**
 * Everything the platform holds about one person, in one response.
 *
 * Assembled here rather than by hand, so it cannot quietly omit a table
 * somebody forgot. When a module gains a table holding personal data, it
 * belongs in this function — and the test asserts the shape so a silent
 * omission shows up.
 *
 * Deliberately absent: the audit trail and the ledger. Both mention this
 * person and neither is *about* them — an audit row is the platform's record
 * of its own conduct, and a ledger entry has another party on the other side.
 * Returning them would disclose somebody else's data in answer to a subject
 * access request, which is the commonest way such a request goes wrong.
 */
export async function exportSubjectData(userId: string) {
  const [
    user,
    profile,
    identity,
    registrations,
    credentials,
    availability,
    blocks,
    invitations,
    assignments,
    consents,
    acceptances,
    requests,
    payouts,
    payoutAccounts,
  ] = await Promise.all([
    prisma.user.findUnique({
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
    }),
    prisma.practitionerProfile.findUnique({ where: { userId } }),
    // The NIN itself is never returned: only a keyed digest and the last four
    // are stored, and the digest is not the subject's to receive.
    prisma.identityVerification.findUnique({
      where: { userId },
      select: { ninLast4: true, nameMatch: true, method: true, verifiedAt: true },
    }),
    prisma.professionalRegistration.findMany({ where: { userId } }),
    prisma.credentialSubmission.findMany({ where: { userId } }),
    prisma.availabilitySlot.findMany({ where: { userId } }),
    prisma.blockedPeriod.findMany({ where: { userId } }),
    prisma.invitation.findMany({ where: { userId } }),
    prisma.assignment.findMany({ where: { userId } }),
    prisma.consentRecord.findMany({ where: { userId } }),
    prisma.agreementAcceptance.findMany({
      where: { userId },
      include: { version: { select: { identifier: true, title: true } } },
    }),
    prisma.dataSubjectRequest.findMany({ where: { userId } }),
    prisma.payout.findMany({ where: { practitionerId: userId } }),
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

  if (!user) throw DataSubjectErrors.notFound();

  return {
    generatedAt: new Date(),
    // Said in the export itself, because somebody reading it will wonder
    // where the rest is.
    notIncluded: {
      auditTrail:
        'The audit trail records what the platform did, not what it holds about you, and it names other people. It is retained under a legal obligation.',
      ledger:
        'Financial entries have another party on the other side of them. Your own payments appear under "payouts".',
      nin: 'Your NIN is not stored — only a keyed digest of it and the last four digits, which are shown.',
      bankAccountNumbers:
        'Your bank account numbers are stored sealed and are opened only to make a transfer to you. Only the last four digits are shown here, as they are everywhere else.',
    },
    account: user,
    profile,
    identityVerification: identity,
    professionalRegistrations: registrations,
    credentials,
    availability: { slots: availability, blocks },
    invitations,
    assignments,
    consent: consents,
    agreementsAccepted: acceptances.map((row: (typeof acceptances)[number]) => ({
      identifier: row.version.identifier,
      title: row.version.title,
      acceptedAt: row.acceptedAt,
    })),
    dataSubjectRequests: requests,
    payouts,
    payoutAccounts,
  };
}

/**
 * Whether an erasure can be actioned, and what it would actually do.
 *
 * Returns rather than throws: the answer to "can I be erased" is information
 * the subject is entitled to before they ask, and an exception is a poor way
 * to carry three reasons and an explanation.
 */
export async function assessErasure(
  userId: string,
  db: Pick<Tx, 'assignment' | 'dispute' | 'ledgerEntry'> = prisma,
) {
  const [confirmedAssignments, owedKobo, openDisputes] = await Promise.all([
    db.assignment.count({ where: { userId, status: 'CONFIRMED' } }),
    amountOwed(userId, db),
    db.dispute.count({
      where: { assignment: { userId }, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
    }),
  ]);

  const blockers = erasureBlockers({ confirmedAssignments, owedKobo, openDisputes });

  return {
    canProceed: blockers.length === 0,
    blockers: blockers.map((blocker) => ({
      code: blocker,
      explanation: BLOCKER_EXPLANATIONS[blocker],
    })),
    // Stated whether or not it can proceed, because it is the part people are
    // surprised by and being surprised later is worse.
    whatErasureDoes: ERASURE_EXEMPT_REASON,
  };
}
