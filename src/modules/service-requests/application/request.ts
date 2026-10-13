import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { getFacility } from '@/modules/facilities/application/facility';
import { assertFacilityTermsAccepted } from '@/modules/audit-compliance/application/consent';
import {
  cancelBookingsForRequest,
  withdrawOutstandingInvitations,
} from '@/modules/matching/application/assignment';
import {
  canTransition,
  MAX_SHIFT_HOURS,
  publishBlockers,
  shiftHours,
  type ServiceRequestStatusValue,
} from '../domain/request';
import { checkAgainstFloor, resolveRateFloor } from '../domain/rate-floor';
import { ServiceRequestErrors } from '../domain/errors';

/**
 * Service requests: a facility's stated need, from draft to published.
 *
 * The facility is reached through `getFacility` rather than by querying its
 * table — modules talk through each other's application layer, never by
 * joining. That call is also what brings `canPublish` into this stage, which
 * is the Stage 5 gate condition 5.10 could not close on its own.
 */

export interface ServiceRequestView {
  id: string;
  facilityId: string;
  professionalCategoryId: string;
  specialtyId: string | null;
  shiftType: 'DAY' | 'NIGHT';
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  hourlyRateKobo: number;
  currency: string;
  urgency: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  cancellationTerms: string;
  notes: string | null;
  status: ServiceRequestStatusValue;
  createdBy: string;
  publishedBy: string | null;
  publishedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type RequestRow = ServiceRequestView & { deletedAt: Date | null };

/** Enumerated rather than spread, so a new column cannot leak into a response. */
function toView(row: RequestRow): ServiceRequestView {
  return {
    id: row.id,
    facilityId: row.facilityId,
    professionalCategoryId: row.professionalCategoryId,
    specialtyId: row.specialtyId,
    shiftType: row.shiftType,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    headcount: row.headcount,
    hourlyRateKobo: row.hourlyRateKobo,
    currency: row.currency,
    urgency: row.urgency,
    cancellationTerms: row.cancellationTerms,
    notes: row.notes,
    status: row.status,
    createdBy: row.createdBy,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Which floor governs this request, from `config.rate_floors`. Config is
 * reference data rather than another module's tables, so it is read directly.
 */
async function floorFor(input: {
  professionalCategoryId: string;
  specialtyId: string | null;
  shiftType: 'DAY' | 'NIGHT';
  at: Date;
}) {
  const [category, specialty] = await Promise.all([
    prisma.professionalCategory.findUnique({
      where: { id: input.professionalCategoryId },
      select: { key: true },
    }),
    input.specialtyId
      ? prisma.specialty.findUnique({ where: { id: input.specialtyId }, select: { key: true } })
      : Promise.resolve(null),
  ]);
  if (!category) throw ServiceRequestErrors.invalidCategory();

  const floors = await prisma.rateFloor.findMany({ where: { categoryKey: category.key } });

  return resolveRateFloor(floors, {
    categoryKey: category.key,
    specialtyKey: specialty?.key ?? null,
    shiftType: input.shiftType,
    at: input.at,
  });
}

export interface CreateServiceRequestParams {
  facilityId: string;
  professionalCategoryId: string;
  specialtyId?: string;
  shiftType: 'DAY' | 'NIGHT';
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  hourlyRateKobo: number;
  urgency: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  cancellationTerms: string;
  notes?: string;
  actorId: string;
}

export async function createServiceRequest(
  input: CreateServiceRequestParams,
): Promise<ServiceRequestView> {
  // Reaches the facility through its own module, and 404s if it is not there.
  await getFacility(input.facilityId);

  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw ServiceRequestErrors.endBeforeStart();
  }
  if (shiftHours(input.startsAt, input.endsAt) > MAX_SHIFT_HOURS) {
    throw ServiceRequestErrors.shiftTooLong(MAX_SHIFT_HOURS);
  }

  const category = await prisma.professionalCategory.findUnique({
    where: { id: input.professionalCategoryId },
  });
  if (!category) throw ServiceRequestErrors.invalidCategory();

  if (input.specialtyId) {
    const specialty = await prisma.specialty.findUnique({ where: { id: input.specialtyId } });
    // A specialty belongs to exactly one category; asking for a paediatrician
    // under "nurse" is a request nobody could fill.
    if (!specialty || specialty.categoryId !== input.professionalCategoryId) {
      throw ServiceRequestErrors.invalidSpecialty();
    }
  }

  // Checked at creation as well as at publish, so a facility learns the rate
  // is illegal while writing the request rather than at the last step.
  const floor = await floorFor({
    professionalCategoryId: input.professionalCategoryId,
    specialtyId: input.specialtyId ?? null,
    shiftType: input.shiftType,
    at: input.startsAt,
  });
  const verdict = checkAgainstFloor(input.hourlyRateKobo, floor);
  if (!verdict.ok && verdict.minHourlyKobo !== null) {
    throw ServiceRequestErrors.belowRateFloor(verdict.minHourlyKobo);
  }

  return prisma.$transaction(async (tx: Tx) => {
    const created = await tx.serviceRequest.create({
      data: {
        facilityId: input.facilityId,
        professionalCategoryId: input.professionalCategoryId,
        specialtyId: input.specialtyId,
        shiftType: input.shiftType,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        headcount: input.headcount,
        hourlyRateKobo: input.hourlyRateKobo,
        urgency: input.urgency,
        cancellationTerms: input.cancellationTerms,
        notes: input.notes,
        createdBy: input.actorId,
      },
    });

    await recordAudit(tx, {
      action: 'service_request.created',
      entityType: 'service_requests.service_requests',
      entityId: created.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: input.facilityId,
      after: toView(created),
    });

    return toView(created);
  });
}

async function loadForFacility(requestId: string, facilityId: string): Promise<RequestRow> {
  const request = await prisma.serviceRequest.findFirst({
    where: { id: requestId, facilityId, deletedAt: null },
  });
  // Scoped by facility in the lookup itself: naming a facility you hold
  // permission for and an id belonging to another gives a 404, not a
  // window into someone else's requests.
  if (!request) throw ServiceRequestErrors.requestNotFound();
  return request;
}

export interface PublishServiceRequestParams {
  requestId: string;
  facilityId: string;
  actorId: string;
}

export async function publishServiceRequest(
  input: PublishServiceRequestParams,
): Promise<ServiceRequestView> {
  const request = await loadForFacility(input.requestId, input.facilityId);
  const facility = await getFacility(input.facilityId);

  // A hospital that has not accepted its terms cannot put a shift in front of
  // practitioners: the fee and the rules cannot bind somebody who never agreed.
  await assertFacilityTermsAccepted(input.facilityId);

  // Re-checked at publish, because a floor can move between drafting and
  // publishing and the published rate is the one that counts.
  const floor = await floorFor({
    professionalCategoryId: request.professionalCategoryId,
    specialtyId: request.specialtyId,
    shiftType: request.shiftType,
    at: request.startsAt,
  });
  const verdict = checkAgainstFloor(request.hourlyRateKobo, floor);

  const blockers = publishBlockers({
    status: request.status,
    startsAt: request.startsAt,
    facilityCanPublish: facility.canPublish,
    rateMeetsFloor: verdict.ok,
  });

  if (blockers.includes('facility_cannot_publish')) {
    throw ServiceRequestErrors.facilityCannotPublish(facility.publishBlockers);
  }
  if (blockers.includes('below_rate_floor') && verdict.minHourlyKobo !== null) {
    throw ServiceRequestErrors.belowRateFloor(verdict.minHourlyKobo);
  }
  if (blockers.includes('starts_in_the_past')) throw ServiceRequestErrors.startsInThePast();
  if (blockers.includes('not_a_draft')) throw ServiceRequestErrors.notADraft();

  const now = new Date();

  return prisma.$transaction(async (tx: Tx) => {
    // Conditional on the status just read, so two concurrent publishes cannot
    // both apply.
    const applied = await tx.serviceRequest.updateMany({
      where: { id: request.id, status: 'DRAFT' },
      data: { status: 'PUBLISHED', publishedBy: input.actorId, publishedAt: now },
    });
    if (applied.count !== 1) throw ServiceRequestErrors.notADraft();

    const updated = await tx.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });

    await recordAudit(tx, {
      action: 'service_request.published',
      entityType: 'service_requests.service_requests',
      entityId: updated.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: input.facilityId,
      before: toView(request),
      after: toView(updated),
    });

    await publishEvent(tx, {
      eventType: EVENTS.ServiceRequestPublished,
      aggregateType: 'service_requests.service_requests',
      aggregateId: updated.id,
      payload: {
        requestId: updated.id,
        facilityId: updated.facilityId,
        professionalCategoryId: updated.professionalCategoryId,
        startsAt: updated.startsAt.toISOString(),
      },
    });

    return toView(updated);
  });
}

export interface CancelServiceRequestParams {
  requestId: string;
  facilityId: string;
  actorId: string;
  reason: string;
}

export async function cancelServiceRequest(
  input: CancelServiceRequestParams,
): Promise<ServiceRequestView> {
  const request = await loadForFacility(input.requestId, input.facilityId);

  if (!canTransition(request.status, 'CANCELLED')) {
    throw ServiceRequestErrors.invalidTransition(request.status, 'CANCELLED');
  }

  const now = new Date();

  return prisma.$transaction(async (tx: Tx) => {
    // Conditional on the status just read: two cancellations at once, or a
    // cancellation racing the expiry sweep, apply once and the other is told
    // the shift is no longer cancellable.
    const applied = await tx.serviceRequest.updateMany({
      where: { id: request.id, status: request.status },
      data: { status: 'CANCELLED', cancelledAt: now, cancellationReason: input.reason },
    });
    if (applied.count !== 1) {
      throw ServiceRequestErrors.invalidTransition(request.status, 'CANCELLED');
    }
    const updated = await tx.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });

    // Nobody should be left holding an offer for a shift that no longer exists.
    const invitationsWithdrawn = await withdrawOutstandingInvitations(tx, {
      requestId: request.id,
      actorId: input.actorId,
      reason: `The facility cancelled the shift: ${input.reason}`,
      now,
    });

    // ...or a booking. People already confirmed are released with the same
    // reason on their history, and told.
    const bookingsCancelled = await cancelBookingsForRequest(tx, {
      requestId: request.id,
      actorId: input.actorId,
      reason: `The facility cancelled the shift: ${input.reason}`,
    });

    await recordAudit(tx, {
      action: 'service_request.cancelled',
      entityType: 'service_requests.service_requests',
      entityId: updated.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: input.facilityId,
      reason: input.reason,
      before: toView(request),
      after: { ...toView(updated), invitationsWithdrawn, bookingsCancelled },
    });

    return toView(updated);
  });
}

export async function getServiceRequest(input: {
  requestId: string;
  facilityId: string;
}): Promise<ServiceRequestView> {
  return toView(await loadForFacility(input.requestId, input.facilityId));
}

export interface ListServiceRequestsQuery {
  scopeType: 'FACILITY' | 'PLATFORM';
  scopeId?: string;
  status?: ServiceRequestStatusValue;
  professionalCategoryId?: string;
  search?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}

export interface ServiceRequestsPage {
  requests: ServiceRequestView[];
  nextCursor: string | null;
}

export async function listServiceRequests(
  query: ListServiceRequestsQuery,
): Promise<ServiceRequestsPage> {
  const where: Prisma.ServiceRequestWhereInput = { deletedAt: null };

  if (query.scopeType !== 'PLATFORM' || query.scopeId) where.facilityId = query.scopeId;
  if (query.status) where.status = query.status;
  if (query.professionalCategoryId) where.professionalCategoryId = query.professionalCategoryId;
  if (query.search) where.notes = { contains: query.search, mode: 'insensitive' };
  if (query.from || query.to) {
    where.startsAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }

  const rows = await prisma.serviceRequest.findMany({
    where,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const requests = rows.slice(0, query.limit).map(toView);

  return {
    requests,
    nextCursor: rows.length > query.limit ? (requests[requests.length - 1]?.id ?? null) : null,
  };
}
