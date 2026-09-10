import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { getServiceRequest } from '@/modules/service-requests/application/request';
import { listMatchCandidates } from '@/modules/practitioners/application/candidates';
import { availabilityForWindow } from '@/modules/availability/application/availability';
import {
  match,
  proximityTier,
  WEIGHTS,
  type CandidateInput,
  type ExcludedCandidate,
  type RankedCandidate,
} from '../domain/engine';

/**
 * Running a match: gather the inputs, hand them to the pure engine, and write
 * down what it decided.
 *
 * Every cross-module read goes through that module's application layer —
 * `getServiceRequest`, `listMatchCandidates`, `availabilityForWindow` — so
 * this module joins nothing it does not own.
 */

/** Hours before a shift that count toward the fatigue factor. */
const FATIGUE_WINDOW_HOURS = 7 * 24;

export interface MatchRunView {
  id: string;
  serviceRequestId: string;
  consideredCount: number;
  rankedCount: number;
  ranked: RankedCandidate[];
  excluded: ExcludedCandidate[];
  createdAt: Date;
}

export interface RunMatchParams {
  requestId: string;
  facilityId: string;
  actorId: string;
}

export async function runMatch(input: RunMatchParams): Promise<MatchRunView> {
  const request = await getServiceRequest({
    requestId: input.requestId,
    facilityId: input.facilityId,
  });

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: request.facilityId },
    select: { stateId: true, lgaId: true },
  });

  const profiles = await listMatchCandidates({
    professionalCategoryId: request.professionalCategoryId,
  });

  const window = { startsAt: request.startsAt, endsAt: request.endsAt };
  const fatigueFrom = new Date(request.startsAt.getTime() - FATIGUE_WINDOW_HOURS * 60 * 60 * 1000);

  const candidates: CandidateInput[] = [];

  for (const profile of profiles) {
    const availability = await availabilityForWindow(profile.userId, window);

    // Anything this practitioner is already committed to that overlaps the
    // shift. The engine only needs to know whether there is one; the
    // confirmation path is what prevents a second being created.
    const conflicting = await prisma.assignment.count({
      where: {
        userId: profile.userId,
        status: 'CONFIRMED',
        startsAt: { lt: request.endsAt },
        endsAt: { gt: request.startsAt },
      },
    });

    const committed = await prisma.assignment.findMany({
      where: {
        userId: profile.userId,
        status: 'CONFIRMED',
        startsAt: { gte: fatigueFrom, lt: request.startsAt },
      },
      select: { startsAt: true, endsAt: true },
    });
    const hoursAssignedInWindow = committed.reduce(
      (sum, assignment) =>
        sum + (assignment.endsAt.getTime() - assignment.startsAt.getTime()) / (60 * 60 * 1000),
      0,
    );

    candidates.push({
      userId: profile.userId,
      professionalCategoryId: profile.professionalCategoryId,
      specialtyId: profile.specialtyId,
      yearsOfExperience: profile.yearsOfExperience,
      proximity: proximityTier({
        facilityStateId: facility.stateId,
        facilityLgaId: facility.lgaId,
        homeStateId: profile.homeStateId,
        homeLgaId: profile.homeLgaId,
      }),
      travelPreference: profile.travelPreference,
      eligible: profile.eligible,
      availability: availability.reason,
      hasConflictingAssignment: conflicting > 0,
      hoursAssignedInWindow,
      completedAssignments: profile.completedAssignments,
      reliabilityScore: profile.reliabilityScore,
    });
  }

  const result = match(
    {
      professionalCategoryId: request.professionalCategoryId,
      specialtyId: request.specialtyId,
    },
    candidates,
  );

  return prisma.$transaction(async (tx: Tx) => {
    const run = await tx.matchRun.create({
      data: {
        serviceRequestId: request.id,
        runBy: input.actorId,
        consideredCount: candidates.length,
        rankedCount: result.ranked.length,
        // Recorded with the run: without them an old ranking cannot be read
        // back once the weights change.
        weights: WEIGHTS,
      },
    });

    if (result.ranked.length > 0) {
      await tx.matchCandidate.createMany({
        data: result.ranked.map((candidate) => ({
          matchRunId: run.id,
          userId: candidate.userId,
          rank: candidate.rank,
          score: candidate.score,
          // Prisma's Json input wants a plain value; the typed array is
          // structurally JSON already, following the same cast
          // recordAudit and publishEvent use for their payloads.
          factors: candidate.factors as unknown as Prisma.InputJsonValue,
          exclusions: [],
        })),
      });
    }

    if (result.excluded.length > 0) {
      await tx.matchCandidate.createMany({
        data: result.excluded.map((candidate) => ({
          matchRunId: run.id,
          userId: candidate.userId,
          exclusions: candidate.reasons,
        })),
      });
    }

    await recordAudit(tx, {
      action: 'matching.run',
      entityType: 'matching.match_runs',
      entityId: run.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: request.facilityId,
      after: {
        serviceRequestId: request.id,
        consideredCount: candidates.length,
        rankedCount: result.ranked.length,
      },
    });

    return {
      id: run.id,
      serviceRequestId: request.id,
      consideredCount: candidates.length,
      rankedCount: result.ranked.length,
      ranked: result.ranked,
      excluded: result.excluded,
      createdAt: run.createdAt,
    };
  });
}

export interface StoredMatchCandidate {
  userId: string;
  rank: number | null;
  score: number | null;
  factors: unknown;
  exclusions: string[];
}

/**
 * A run read back afterwards. This is the half of "explainable" that matters
 * — a ranking nobody can revisit explains nothing — and it is what step 6.3's
 * gate evidence ("the explainability output for one real match") comes from.
 */
export async function getMatchRun(input: {
  matchRunId: string;
  facilityId: string;
}): Promise<{
  id: string;
  serviceRequestId: string;
  weights: unknown;
  createdAt: Date;
  candidates: StoredMatchCandidate[];
} | null> {
  const run = await prisma.matchRun.findFirst({
    where: { id: input.matchRunId, serviceRequest: { facilityId: input.facilityId } },
    include: { candidates: { orderBy: [{ rank: 'asc' }, { userId: 'asc' }] } },
  });
  if (!run) return null;

  return {
    id: run.id,
    serviceRequestId: run.serviceRequestId,
    weights: run.weights,
    createdAt: run.createdAt,
    candidates: run.candidates.map((candidate) => ({
      userId: candidate.userId,
      rank: candidate.rank,
      score: candidate.score,
      factors: candidate.factors,
      exclusions: candidate.exclusions,
    })),
  };
}
