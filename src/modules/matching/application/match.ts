import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { getServiceRequest } from '@/modules/service-requests/application/request';
import { listMatchCandidates } from '@/modules/practitioners/application/candidates';
import { availabilityForWindowBatch } from '@/modules/availability/application/availability';
import {
  match,
  proximityTier,
  WEIGHTS,
  type CandidateInput,
  type ExcludedCandidate,
  type RankedCandidate,
} from '../domain/engine';
import { reliabilityFrom } from '../domain/reliability';
import { assignmentOutcomesFor } from './assignment';

/**
 * Running a match: gather the inputs, hand them to the pure engine, and write
 * down what it decided.
 *
 * Every cross-module read goes through that module's application layer —
 * `getServiceRequest`, `listMatchCandidates`, `availabilityForWindowBatch`
 * — so this module joins nothing it does not own.
 *
 * Everything is gathered for the whole shortlist before the engine sees
 * any of it. It used to be gathered per candidate, inside the loop: six
 * queries each here and eight more inside `listMatchCandidates`, so
 * ranking two hundred practitioners for one shift issued roughly two
 * thousand eight hundred queries. The engine is unchanged — it was never
 * the slow part.
 */

/** Hours before a shift that count toward the fatigue factor. */
const FATIGUE_WINDOW_HOURS = 7 * 24;

export interface RankedCandidateView extends RankedCandidate {
  practitionerName: string;
  practitionerPhone: string;
}

export interface ExcludedCandidateView extends ExcludedCandidate {
  practitionerName: string;
  practitionerPhone: string;
}

export interface MatchRunView {
  id: string;
  serviceRequestId: string;
  consideredCount: number;
  rankedCount: number;
  ranked: RankedCandidateView[];
  excluded: ExcludedCandidateView[];
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

  const userIds = profiles.map((profile) => profile.userId);

  // Assignments are read here rather than in `listMatchCandidates`, because
  // they are matching's own table: having practitioners count them would have
  // that module reach into this one, and the two already point the other way.
  const [availability, outcomes, conflicting, committed] = await Promise.all([
    availabilityForWindowBatch(userIds, window),
    assignmentOutcomesFor(userIds),
    // Anything a practitioner is already committed to that overlaps the shift.
    // The engine only needs to know whether there is one; the confirmation
    // path is what prevents a second being created — so this collects the ids
    // that have one rather than counting per person.
    prisma.assignment.findMany({
      where: {
        userId: { in: userIds },
        status: 'CONFIRMED',
        startsAt: { lt: request.endsAt },
        endsAt: { gt: request.startsAt },
      },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.assignment.findMany({
      where: {
        userId: { in: userIds },
        status: 'CONFIRMED',
        startsAt: { gte: fatigueFrom, lt: request.startsAt },
      },
      select: { userId: true, startsAt: true, endsAt: true },
    }),
  ]);

  const hasConflict = new Set(conflicting.map((row) => row.userId));

  const hoursOf = new Map<string, number>();
  for (const assignment of committed) {
    const hours = (assignment.endsAt.getTime() - assignment.startsAt.getTime()) / (60 * 60 * 1000);
    hoursOf.set(assignment.userId, (hoursOf.get(assignment.userId) ?? 0) + hours);
  }

  const candidates: CandidateInput[] = profiles.map((profile) => {
    const theirOutcomes = outcomes.get(profile.userId) ?? { completed: 0, noShow: 0 };

    return {
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
      availability: availability.get(profile.userId)!.reason,
      hasConflictingAssignment: hasConflict.has(profile.userId),
      hoursAssignedInWindow: hoursOf.get(profile.userId) ?? 0,
      completedAssignments: theirOutcomes.completed,
      reliabilityScore: reliabilityFrom(theirOutcomes),
    };
  });

  const result = match(
    {
      professionalCategoryId: request.professionalCategoryId,
      specialtyId: request.specialtyId,
    },
    candidates,
  );

  // The engine works in ids, by design — see `engine.ts`, pure and
  // database-free. A reviewer deciding who to offer a shift to needs a name
  // against every one of them, ranked and excluded alike, so that is added
  // here, at the boundary, rather than inside the scoring itself.
  const involvedIds = [
    ...new Set([...result.ranked.map((c) => c.userId), ...result.excluded.map((c) => c.userId)]),
  ];
  const people = involvedIds.length
    ? await prisma.user.findMany({
        where: { id: { in: involvedIds } },
        select: { id: true, fullName: true, phone: true },
      })
    : [];
  const byId = new Map(people.map((person) => [person.id, person]));
  const nameFor = (userId: string) => byId.get(userId)?.fullName ?? 'Unknown practitioner';
  const phoneFor = (userId: string) => byId.get(userId)?.phone ?? '';

  const ranked: RankedCandidateView[] = result.ranked.map((candidate) => ({
    ...candidate,
    practitionerName: nameFor(candidate.userId),
    practitionerPhone: phoneFor(candidate.userId),
  }));
  const excluded: ExcludedCandidateView[] = result.excluded.map((candidate) => ({
    ...candidate,
    practitionerName: nameFor(candidate.userId),
    practitionerPhone: phoneFor(candidate.userId),
  }));

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
      ranked,
      excluded,
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
