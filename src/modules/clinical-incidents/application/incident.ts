import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { HttpError } from '@/lib/http/errors';
import { getAssignment } from '@/modules/matching/application/assignment';
import {
  closeBlockers,
  outcomeSuspends,
  reportBlockers,
  type IncidentCategoryValue,
  type IncidentOutcomeValue,
  type IncidentSeverityValue,
  type IncidentStatusValue,
} from '../domain/incident';
import { suspendAccount } from './suspension';

/**
 * Module 15: a patient-safety event during or around a shift.
 *
 * **A report is not an accusation**, and the code says so in three places:
 * reporting asks for a summary and nothing else, nothing here deletes or
 * edits a report once made, and the practitioner a report names is a subject
 * rather than a defendant. Whether anything follows is a separate decision
 * with `incident.manage` behind it.
 */

export const IncidentErrors = {
  notFound: () => new HttpError('incident_not_found', 'That incident does not exist.', 404),

  assignmentNotFound: () =>
    new HttpError('assignment_not_found', 'That assignment does not exist.', 404),

  wrongFacility: () =>
    new HttpError('incident_wrong_facility', 'That shift does not belong to this facility.', 403),

  cannotReport: (blockers: string[]) =>
    new HttpError(
      'incident_cannot_report',
      `This report cannot be filed: ${blockers.join(', ')}.`,
      422,
    ),

  cannotClose: (blockers: string[]) =>
    new HttpError(
      'incident_cannot_close',
      `This incident cannot be closed: ${blockers.join(', ')}.`,
      409,
    ),

  notOpen: () => new HttpError('incident_not_open', 'That incident is already closed.', 409),

  noSubject: () =>
    new HttpError(
      'incident_no_subject',
      'This incident names no practitioner, so there is nobody to suspend.',
      422,
    ),
};

export interface IncidentView {
  id: string;
  facilityId: string;
  assignmentId: string | null;
  subjectUserId: string | null;
  reportedBy: string;
  occurredAt: Date;
  reportedAt: Date;
  severity: IncidentSeverityValue;
  category: IncidentCategoryValue;
  summary: string;
  status: IncidentStatusValue;
  outcome: IncidentOutcomeValue | null;
  closedBy: string | null;
  closedAt: Date | null;
  closureNotes: string | null;
}

interface IncidentRow extends Omit<IncidentView, 'severity' | 'status' | 'outcome' | 'category'> {
  severity: string;
  status: string;
  outcome: string | null;
  category: string;
}

function toView(row: IncidentRow): IncidentView {
  return {
    id: row.id,
    facilityId: row.facilityId,
    assignmentId: row.assignmentId,
    subjectUserId: row.subjectUserId,
    reportedBy: row.reportedBy,
    occurredAt: row.occurredAt,
    reportedAt: row.reportedAt,
    severity: row.severity as IncidentSeverityValue,
    category: row.category as IncidentCategoryValue,
    summary: row.summary,
    status: row.status as IncidentStatusValue,
    outcome: row.outcome as IncidentOutcomeValue | null,
    closedBy: row.closedBy,
    closedAt: row.closedAt,
    closureNotes: row.closureNotes,
  };
}

async function loadIncident(incidentId: string) {
  const row = await prisma.clinicalIncident.findUnique({ where: { id: incidentId } });
  if (!row) throw IncidentErrors.notFound();
  return row;
}

export interface ReportIncidentParams {
  facilityId: string;
  actorId: string;
  assignmentId?: string;
  subjectUserId?: string;
  occurredAt: Date;
  severity: IncidentSeverityValue;
  category: IncidentCategoryValue;
  summary: string;
}

/**
 * Files a report. Deliberately the easiest thing in this module to do.
 *
 * The shift and the practitioner are both optional: an incident found during
 * a case note review a week later may not be traceable to one assignment, and
 * a medication error in a shared cupboard may involve nobody in particular.
 * Refusing either report because the paperwork is untidy loses the report,
 * and the report is the point.
 */
export async function reportIncident(input: ReportIncidentParams): Promise<IncidentView> {
  const blockers = reportBlockers({
    summary: input.summary,
    occurredAt: input.occurredAt,
    now: new Date(),
  });
  if (blockers.length > 0) throw IncidentErrors.cannotReport(blockers);

  // When a shift is named it has to be this facility's, or one facility could
  // file reports against another's shifts.
  let subjectUserId = input.subjectUserId ?? null;
  if (input.assignmentId) {
    const assignment = await getAssignment(input.assignmentId);
    if (!assignment) throw IncidentErrors.assignmentNotFound();
    if (assignment.facilityId !== input.facilityId) throw IncidentErrors.wrongFacility();
    // The shift names the practitioner, so a report that gives one need not.
    subjectUserId = subjectUserId ?? assignment.userId;
  }

  return prisma.$transaction(async (tx: Tx) => {
    const row = await tx.clinicalIncident.create({
      data: {
        facilityId: input.facilityId,
        assignmentId: input.assignmentId,
        subjectUserId,
        reportedBy: input.actorId,
        occurredAt: input.occurredAt,
        severity: input.severity,
        category: input.category,
        summary: input.summary,
      },
    });

    await recordAudit(tx, {
      action: 'incident.reported',
      entityType: 'clinical_incidents.clinical_incidents',
      entityId: row.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: input.facilityId,
      after: { severity: row.severity, category: row.category, status: row.status },
    });

    await publishEvent(tx, {
      eventType: EVENTS.ClinicalIncidentReported,
      aggregateType: 'clinical_incidents.clinical_incidents',
      aggregateId: row.id,
      payload: {
        incidentId: row.id,
        facilityId: input.facilityId,
        assignmentId: input.assignmentId ?? null,
        subjectUserId,
        severity: row.severity,
      },
    });

    return toView(row);
  });
}

/** Compliance picks the case up. Required before a severe one can be closed. */
export async function beginIncidentReview(input: {
  incidentId: string;
  actorId: string;
}): Promise<IncidentView> {
  const existing = await loadIncident(input.incidentId);
  if (existing.status === 'CLOSED') throw IncidentErrors.notOpen();

  return prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.clinicalIncident.updateMany({
      where: { id: existing.id, status: 'REPORTED' },
      data: { status: 'UNDER_REVIEW' },
    });
    // Already under review is not an error: two officers opening the same
    // case is wasted effort, not a correctness problem.
    const row = await tx.clinicalIncident.findUniqueOrThrow({ where: { id: existing.id } });

    if (applied.count === 1) {
      await recordAudit(tx, {
        action: 'incident.review_started',
        entityType: 'clinical_incidents.clinical_incidents',
        entityId: row.id,
        actorId: input.actorId,
        scopeType: 'FACILITY',
        scopeId: row.facilityId,
        before: { status: existing.status },
        after: { status: row.status },
      });
    }

    return toView(row);
  });
}

export interface CloseIncidentParams {
  incidentId: string;
  actorId: string;
  /** Required. A closure with no outcome records that somebody stopped looking. */
  outcome: IncidentOutcomeValue | null;
  notes: string;
}

/**
 * Closes the case with an outcome and a reason.
 *
 * When the outcome is `PRACTITIONER_SUSPENDED` the suspension happens **in
 * the same transaction**, so the two cannot disagree. A closure claiming a
 * suspension that did not happen, or a suspension recorded under `NO_ACTION`,
 * are both records that lie — and this is the only place either could be
 * written.
 *
 * `SYSTEM_ISSUE` is in the outcome list and near the top of it on purpose. It
 * is the commonest true answer to a clinical incident and the one a
 * blame-first process never reaches.
 */
export async function closeIncident(input: CloseIncidentParams): Promise<IncidentView> {
  const existing = await loadIncident(input.incidentId);

  const blockers = closeBlockers({
    status: existing.status as IncidentStatusValue,
    severity: existing.severity as IncidentSeverityValue,
    outcome: input.outcome,
    notes: input.notes ?? '',
  });
  if (blockers.length > 0) throw IncidentErrors.cannotClose(blockers);

  const outcome = input.outcome as IncidentOutcomeValue;
  const suspends = outcomeSuspends(outcome);
  if (suspends && !existing.subjectUserId) throw IncidentErrors.noSubject();

  const now = new Date();

  return prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.clinicalIncident.updateMany({
      where: { id: existing.id, status: { not: 'CLOSED' } },
      data: {
        status: 'CLOSED',
        outcome,
        closedBy: input.actorId,
        closedAt: now,
        closureNotes: input.notes,
      },
    });
    if (applied.count !== 1) throw IncidentErrors.cannotClose(['already_closed']);

    const row = await tx.clinicalIncident.findUniqueOrThrow({ where: { id: existing.id } });

    if (suspends) {
      await suspendAccount({
        userId: existing.subjectUserId as string,
        actorId: input.actorId,
        reason: input.notes,
        incidentId: existing.id,
        tx,
      });
    }

    await recordAudit(tx, {
      action: 'incident.closed',
      entityType: 'clinical_incidents.clinical_incidents',
      entityId: row.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: row.facilityId,
      reason: input.notes,
      before: { status: existing.status, outcome: existing.outcome },
      after: { status: row.status, outcome: row.outcome },
    });

    return toView(row);
  });
}

export async function getIncident(incidentId: string): Promise<IncidentQueueRow> {
  const row = await prisma.clinicalIncident.findUnique({
    where: { id: incidentId },
    include: { facility: { select: { name: true } } },
  });
  if (!row) throw IncidentErrors.notFound();
  return { ...toView(row), facilityName: row.facility.name };
}

/**
 * The compliance queue: everything still open, most serious first and oldest
 * within that. A death reported this morning outranks a near miss from March.
 */
export async function listOpenIncidents(): Promise<IncidentView[]> {
  const rows = await prisma.clinicalIncident.findMany({
    where: { status: { not: 'CLOSED' } },
    orderBy: { reportedAt: 'asc' },
  });

  const { severityRank } = await import('../domain/incident');
  return rows.map(toView).sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

/**
 * The compliance queue, filtered and paged.
 *
 * `listOpenIncidents` takes no arguments and returns every open report, which
 * was right while there were six and wrong at sixty: no way to find one, no
 * way past the first screen, and no way to look at a closed case at all — so
 * an officer could not answer "what did we decide about that one in August?"
 * without going to the database.
 *
 * The facility **name** is joined here because the screen was showing
 * `a2ee9a0e`. An incident belongs to a hospital, and a queue that identifies
 * the hospital by a fragment of a uuid cannot be triaged by a human.
 *
 * Ordering keeps the rule that matters: most serious first, oldest within
 * that. A death reported this morning outranks a near miss from March.
 */
export interface IncidentQueueRow extends IncidentView {
  facilityName: string;
}

export interface IncidentQueuePage {
  incidents: IncidentQueueRow[];
  nextCursor: string | null;
}

export interface ListIncidentsQuery {
  /** Narrows to one facility's own reports; omitted at the compliance queue,
   * which reads across all of them. */
  facilityId?: string;
  status?: IncidentStatusValue | 'OPEN';
  severity?: IncidentSeverityValue;
  category?: IncidentCategoryValue;
  /** Matches the summary text. */
  search?: string;
  limit: number;
  cursor?: string;
}

export async function listIncidents(query: ListIncidentsQuery): Promise<IncidentQueuePage> {
  const where: Prisma.ClinicalIncidentWhereInput = {};

  if (query.facilityId) where.facilityId = query.facilityId;

  // "OPEN" is not a stored status — it is the compliance queue's own idea of
  // everything still needing a person. Left unstated, no status filter
  // applies at all, same as every other optional filter here — a facility
  // reading its own history wants everything it has ever filed, not just
  // what is still open.
  if (query.status === 'OPEN') {
    where.status = { not: 'CLOSED' };
  } else if (query.status) {
    where.status = query.status;
  }

  if (query.severity) where.severity = query.severity;
  if (query.category) where.category = query.category;
  if (query.search) where.summary = { contains: query.search.trim(), mode: 'insensitive' };

  const rows = await prisma.clinicalIncident.findMany({
    where,
    orderBy: [{ reportedAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: { facility: { select: { name: true } } },
  });

  const page = rows.slice(0, query.limit);
  const { severityRank } = await import('../domain/incident');

  const incidents = page
    .map((row) => ({ ...toView(row), facilityName: row.facility.name }))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  return {
    incidents,
    // Taken from the page as fetched, not as sorted: the cursor has to follow
    // the database's order or the next page skips rows.
    nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Every report naming this practitioner. Compliance reads this before deciding. */
export async function listIncidentsForSubject(subjectUserId: string): Promise<IncidentQueueRow[]> {
  const rows = await prisma.clinicalIncident.findMany({
    where: { subjectUserId },
    orderBy: { reportedAt: 'desc' },
    include: { facility: { select: { name: true } } },
  });
  return rows.map((row) => ({ ...toView(row), facilityName: row.facility.name }));
}
