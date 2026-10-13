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

/**
 * The allowances a booking is priced on, fixed when it is made.
 *
 * Copied onto the assignment, because the card itself can be replaced: priced
 * from "whichever card is active when the invoice is raised", a facility could
 * book a night shift under one card, supersede it with a cheaper one, and have
 * the practitioner paid the lower figure for work agreed at the higher.
 */
export interface RateTerms extends RateCardLike {
  /** The card these came from; null when the facility had none and the terms are par. */
  rateCardId: string | null;
  fixedAt: string;
}

/**
 * The card in force on `shiftStartsAt`: it began on or before that moment and
 * had not been superseded by it. A card made now applies to a shift next month,
 * the card it replaced does not, and a card dated for next month does not apply
 * to a shift next week. Not "the active card": that is a statement about today.
 *
 * A facility with no card in force on that date is at par on every band, which is
 * exactly how it behaved before this module existed.
 */
export async function rateTermsFor(
  facilityId: string,
  shiftStartsAt: Date,
  now: Date = new Date(),
): Promise<RateTerms> {
  const row = await prisma.rateCard.findFirst({
    where: {
      facilityId,
      status: { not: 'DRAFT' },
      effectiveFrom: { lte: shiftStartsAt },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: shiftStartsAt } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  return {
    rateCardId: row?.id ?? null,
    nightMultiplierBp: row?.nightMultiplierBp ?? DEFAULT_RATE_CARD.nightMultiplierBp,
    holidayMultiplierBp: row?.holidayMultiplierBp ?? DEFAULT_RATE_CARD.holidayMultiplierBp,
    overtimeMultiplierBp: row?.overtimeMultiplierBp ?? DEFAULT_RATE_CARD.overtimeMultiplierBp,
    onCallMultiplierBp: row?.onCallMultiplierBp ?? DEFAULT_RATE_CARD.onCallMultiplierBp,
    fixedAt: now.toISOString(),
  };
}

/** Reads terms back off a booking, or null if it has none (made before they were kept) or they are malformed. */
export function readRateTerms(value: unknown): RateTerms | null {
  if (!value || typeof value !== 'object') return null;
  const terms = value as Record<string, unknown>;
  const bands = ['nightMultiplierBp', 'holidayMultiplierBp', 'overtimeMultiplierBp', 'onCallMultiplierBp'] as const;
  if (!bands.every((band) => Number.isInteger(terms[band]))) return null;

  return {
    rateCardId: typeof terms.rateCardId === 'string' ? terms.rateCardId : null,
    nightMultiplierBp: terms.nightMultiplierBp as number,
    holidayMultiplierBp: terms.holidayMultiplierBp as number,
    overtimeMultiplierBp: terms.overtimeMultiplierBp as number,
    onCallMultiplierBp: terms.onCallMultiplierBp as number,
    fixedAt: typeof terms.fixedAt === 'string' ? terms.fixedAt : '',
  };
}

/**
 * The terms a booking is priced on: the ones kept on it, or, for a booking made
 * before terms were kept, the card in force on the shift's date.
 */
export async function termsOfBooking(booking: {
  facilityId: string;
  startsAt: Date;
  rateTerms: unknown;
}): Promise<RateTerms> {
  return readRateTerms(booking.rateTerms) ?? rateTermsFor(booking.facilityId, booking.startsAt);
}
