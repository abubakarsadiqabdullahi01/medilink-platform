import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import {
  DEFAULT_RATE_CARD,
  multiplierProblems,
  type RateCardLike,
} from '../domain/pricing';

/**
 * Module 11: a facility's allowances.
 *
 * One card is active at a time. Creating a new one supersedes the old, and
 * the old is kept with its dates — an invoice raised last month has to stay
 * readable against the card that priced it, so nothing here deletes or
 * rewrites a card that has been used.
 */

export const RateCardErrors = {
  notFound: () => new HttpError('rate_card_not_found', 'That rate card does not exist.', 404),

  invalidMultiplier: (band: string, problems: string[]) =>
    new HttpError(
      'rate_card_invalid',
      `The ${band} multiplier is not usable: ${problems.join(', ')}.`,
      422,
    ),
};

export interface RateCardView extends RateCardLike {
  id: string;
  facilityId: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  createdAt: Date;
}

function toView(row: {
  id: string;
  facilityId: string;
  name: string;
  status: string;
  nightMultiplierBp: number;
  holidayMultiplierBp: number;
  overtimeMultiplierBp: number;
  onCallMultiplierBp: number;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  createdAt: Date;
}): RateCardView {
  return {
    id: row.id,
    facilityId: row.facilityId,
    name: row.name,
    status: row.status as RateCardView['status'],
    nightMultiplierBp: row.nightMultiplierBp,
    holidayMultiplierBp: row.holidayMultiplierBp,
    overtimeMultiplierBp: row.overtimeMultiplierBp,
    onCallMultiplierBp: row.onCallMultiplierBp,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
    createdAt: row.createdAt,
  };
}

export interface CreateRateCardParams extends Partial<RateCardLike> {
  facilityId: string;
  actorId: string;
  name: string;
  effectiveFrom?: Date;
}

/**
 * Creates a card and makes it the active one.
 *
 * Both in one transaction, because a moment with two active cards would let a
 * concurrent invoice pick either — and which one it picked would be invisible
 * afterwards.
 */
export async function createRateCard(input: CreateRateCardParams): Promise<RateCardView> {
  const card: RateCardLike = {
    nightMultiplierBp: input.nightMultiplierBp ?? DEFAULT_RATE_CARD.nightMultiplierBp,
    holidayMultiplierBp: input.holidayMultiplierBp ?? DEFAULT_RATE_CARD.holidayMultiplierBp,
    overtimeMultiplierBp: input.overtimeMultiplierBp ?? DEFAULT_RATE_CARD.overtimeMultiplierBp,
    onCallMultiplierBp: input.onCallMultiplierBp ?? DEFAULT_RATE_CARD.onCallMultiplierBp,
  };

  for (const [band, bp] of Object.entries(card)) {
    const problems = multiplierProblems(bp);
    if (problems.length > 0) throw RateCardErrors.invalidMultiplier(band, problems);
  }

  const effectiveFrom = input.effectiveFrom ?? new Date();

  return prisma.$transaction(async (tx: Tx) => {
    await tx.rateCard.updateMany({
      where: { facilityId: input.facilityId, status: 'ACTIVE' },
      data: { status: 'SUPERSEDED', effectiveUntil: effectiveFrom },
    });

    const created = await tx.rateCard.create({
      data: {
        facilityId: input.facilityId,
        name: input.name,
        ...card,
        status: 'ACTIVE',
        effectiveFrom,
        createdBy: input.actorId,
      },
    });

    await recordAudit(tx, {
      action: 'rate_card.created',
      entityType: 'rates.rate_cards',
      entityId: created.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: input.facilityId,
      after: { name: created.name, ...card },
    });

    return toView(created);
  });
}

/**
 * The card in force, or the default.
 *
 * A facility that has never set one is not an error: the default is par on
 * every band, which is exactly the behaviour before this module existed.
 */
export async function activeRateCard(facilityId: string): Promise<RateCardView | null> {
  const row = await prisma.rateCard.findFirst({
    where: { facilityId, status: 'ACTIVE' },
    orderBy: { effectiveFrom: 'desc' },
  });
  return row ? toView(row) : null;
}

export async function listRateCards(facilityId: string): Promise<RateCardView[]> {
  const rows = await prisma.rateCard.findMany({
    where: { facilityId },
    orderBy: { effectiveFrom: 'desc' },
  });
  return rows.map(toView);
}
