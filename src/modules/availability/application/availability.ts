import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import {
  availabilityFor,
  type AvailabilityVerdict,
  type SlotLike,
  type TimeWindow,
} from '../domain/availability';
import { LOOKAHEAD_DAYS, nextOffered, slotStanding, type SlotStanding } from '../domain/offered';
import { AvailabilityErrors } from '../domain/errors';

/**
 * A practitioner's own availability: the slots they offer and the periods
 * they are away. Read by the matcher in Stage 6.3, written only by the
 * practitioner themselves.
 */

export interface SlotView {
  id: string;
  kind: 'RECURRING_WEEKLY' | 'ONE_OFF';
  dayOfWeek: number | null;
  startMinute: number | null;
  endMinute: number | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface BlockView {
  id: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
}

export interface SlotWithStanding extends SlotView {
  /** Whether it is doing anything today; see `slotStanding`. */
  standing: SlotStanding;
}

/** What the matcher can actually use, worked out by the same model that answers it. */
export interface EffectiveAvailability {
  /**
   * The first stretch they can be offered from now on, or null if there is none. `openEnded` is
   * true when it runs to the edge of what was looked at, so its end is not a date to show: somebody
   * offered every day is offered after the look-ahead too.
   */
  next: { startsAt: Date; endsAt: Date; openEnded: boolean } | null;
  /** How far ahead that looked. */
  lookaheadDays: number;
  /** Whether anything they entered is still in play: a pattern not ended, a window not over. */
  hasUsableSlots: boolean;
}

export interface AvailabilityView {
  userId: string;
  slots: SlotWithStanding[];
  blocks: BlockView[];
  effective: EffectiveAvailability;
}

function toSlotView(row: SlotView): SlotView {
  return {
    id: row.id,
    kind: row.kind,
    dayOfWeek: row.dayOfWeek,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  };
}

function nextStretch(slots: SlotLike[], away: TimeWindow[], now: Date): EffectiveAvailability['next'] {
  const window = nextOffered(slots, away, now);
  if (!window) return null;
  const horizon = now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;
  return { ...window, openEnded: window.endsAt.getTime() >= horizon };
}

/**
 * The practitioner's diary as the matcher reads it: what they entered, where each entry stands
 * today, and the next stretch they can be offered. All of it from the one model in
 * `domain/offered`, so the screen cannot say something the matcher does not do.
 */
export async function getAvailability(userId: string, now: Date = new Date()): Promise<AvailabilityView> {
  const [slots, blocks] = await Promise.all([
    prisma.availabilitySlot.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ kind: 'asc' }, { dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    }),
    prisma.blockedPeriod.findMany({
      where: { userId, deletedAt: null },
      orderBy: { startsAt: 'asc' },
    }),
  ]);

  const away = blocks.map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt }));
  const withStanding = slots.map((row) => ({
    ...toSlotView(row),
    standing: slotStanding(row as SlotLike, away, now),
  }));

  return {
    userId,
    slots: withStanding,
    blocks: blocks.map((row) => ({
      id: row.id,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      reason: row.reason,
    })),
    effective: {
      next: nextStretch(slots as SlotLike[], away, now),
      lookaheadDays: LOOKAHEAD_DAYS,
      hasUsableSlots: withStanding.some((slot) => slot.standing !== 'finished'),
    },
  };
}

/** What `getAvailability` knows that "will they be offered a shift" needs, and no more. */
export async function availabilitySummary(
  userId: string,
  now: Date = new Date(),
): Promise<EffectiveAvailability> {
  return (await getAvailability(userId, now)).effective;
}

export interface AddSlotParams {
  userId: string;
  kind: 'RECURRING_WEEKLY' | 'ONE_OFF';
  dayOfWeek?: number;
  startMinute?: number;
  endMinute?: number;
  effectiveFrom?: Date;
  effectiveUntil?: Date;
  startsAt?: Date;
  endsAt?: Date;
}

export async function addSlot(input: AddSlotParams): Promise<SlotView> {
  // The two shapes need different fields. Checked here rather than in the
  // schema because which fields are required depends on the value of another.
  if (input.kind === 'RECURRING_WEEKLY') {
    if (
      input.dayOfWeek === undefined ||
      input.startMinute === undefined ||
      input.endMinute === undefined
    ) {
      throw AvailabilityErrors.recurringFieldsRequired();
    }
    // Equal start and end is not "all day": it is a slot of no length, and
    // almost always a typo for one that wraps.
    if (input.startMinute === input.endMinute) throw AvailabilityErrors.emptySlot();
    if (
      input.effectiveFrom &&
      input.effectiveUntil &&
      input.effectiveUntil.getTime() <= input.effectiveFrom.getTime()
    ) {
      throw AvailabilityErrors.endBeforeStart();
    }
  } else {
    if (!input.startsAt || !input.endsAt) throw AvailabilityErrors.oneOffFieldsRequired();
    if (input.endsAt.getTime() <= input.startsAt.getTime()) {
      throw AvailabilityErrors.endBeforeStart();
    }
  }

  return prisma.$transaction(async (tx: Tx) => {
    const created = await tx.availabilitySlot.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        dayOfWeek: input.kind === 'RECURRING_WEEKLY' ? input.dayOfWeek : null,
        startMinute: input.kind === 'RECURRING_WEEKLY' ? input.startMinute : null,
        endMinute: input.kind === 'RECURRING_WEEKLY' ? input.endMinute : null,
        effectiveFrom: input.kind === 'RECURRING_WEEKLY' ? input.effectiveFrom : null,
        effectiveUntil: input.kind === 'RECURRING_WEEKLY' ? input.effectiveUntil : null,
        startsAt: input.kind === 'ONE_OFF' ? input.startsAt : null,
        endsAt: input.kind === 'ONE_OFF' ? input.endsAt : null,
      },
    });

    await recordAudit(tx, {
      action: 'availability.slot_added',
      entityType: 'availability.availability_slots',
      entityId: created.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      after: toSlotView(created),
    });

    return toSlotView(created);
  });
}

export async function removeSlot(input: { userId: string; slotId: string }): Promise<void> {
  const existing = await prisma.availabilitySlot.findFirst({
    where: { id: input.slotId, userId: input.userId, deletedAt: null },
  });
  // Someone else's slot is a 404, not a 403: ownership is folded into the
  // lookup, and a distinguishable 403 would confirm the id exists.
  if (!existing) throw AvailabilityErrors.slotNotFound();

  await prisma.$transaction(async (tx: Tx) => {
    const removed = await tx.availabilitySlot.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    await recordAudit(tx, {
      action: 'availability.slot_removed',
      entityType: 'availability.availability_slots',
      entityId: removed.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      before: toSlotView(existing),
    });
  });
}

export interface AddBlockParams {
  userId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
}

export async function addBlock(input: AddBlockParams): Promise<BlockView> {
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw AvailabilityErrors.endBeforeStart();
  }

  return prisma.$transaction(async (tx: Tx) => {
    const created = await tx.blockedPeriod.create({
      data: {
        userId: input.userId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason,
      },
    });

    await recordAudit(tx, {
      action: 'availability.block_added',
      entityType: 'availability.blocked_periods',
      entityId: created.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      reason: input.reason,
      after: { startsAt: created.startsAt, endsAt: created.endsAt },
    });

    return {
      id: created.id,
      startsAt: created.startsAt,
      endsAt: created.endsAt,
      reason: created.reason,
    };
  });
}

export async function removeBlock(input: { userId: string; blockId: string }): Promise<void> {
  const existing = await prisma.blockedPeriod.findFirst({
    where: { id: input.blockId, userId: input.userId, deletedAt: null },
  });
  if (!existing) throw AvailabilityErrors.blockNotFound();

  await prisma.$transaction(async (tx: Tx) => {
    const removed = await tx.blockedPeriod.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    await recordAudit(tx, {
      action: 'availability.block_removed',
      entityType: 'availability.blocked_periods',
      entityId: removed.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      before: { startsAt: existing.startsAt, endsAt: existing.endsAt, reason: existing.reason },
    });
  });
}

/**
 * The matcher's question, answered from the database. Kept here so
 * src/modules/matching never reads this module's tables — cross-module
 * reactions go through an interface, not a join.
 */
export async function availabilityForWindow(
  userId: string,
  window: TimeWindow,
): Promise<AvailabilityVerdict> {
  const verdicts = await availabilityForWindowBatch([userId], window);
  return verdicts.get(userId) ?? availabilityFor([], [], window);
}

/**
 * The same question for a whole shortlist, in two queries rather than two
 * per practitioner.
 *
 * Matching asks this once per candidate, so at two hundred candidates the
 * single-user version was four hundred round trips to answer one question
 * about one shift. The verdict is still computed by the same pure
 * `availabilityFor` per practitioner — only the loading is shared.
 *
 * A practitioner with no slots at all is still in the map, carrying whatever
 * `availabilityFor` says about an empty diary. Leaving them out would make
 * "no slots" indistinguishable from "not asked about", and the matcher would
 * have to guess which.
 */
export async function availabilityForWindowBatch(
  userIds: string[],
  window: TimeWindow,
): Promise<Map<string, AvailabilityVerdict>> {
  const verdicts = new Map<string, AvailabilityVerdict>();
  if (userIds.length === 0) return verdicts;

  const ids = [...new Set(userIds)];

  const [slots, blocks] = await Promise.all([
    prisma.availabilitySlot.findMany({ where: { userId: { in: ids }, deletedAt: null } }),
    prisma.blockedPeriod.findMany({ where: { userId: { in: ids }, deletedAt: null } }),
  ]);

  const slotsOf = new Map<string, SlotLike[]>();
  for (const slot of slots) {
    const list = slotsOf.get(slot.userId) ?? [];
    list.push(slot as SlotLike);
    slotsOf.set(slot.userId, list);
  }

  const blocksOf = new Map<string, { startsAt: Date; endsAt: Date }[]>();
  for (const block of blocks) {
    const list = blocksOf.get(block.userId) ?? [];
    list.push({ startsAt: block.startsAt, endsAt: block.endsAt });
    blocksOf.set(block.userId, list);
  }

  for (const userId of ids) {
    verdicts.set(
      userId,
      availabilityFor(slotsOf.get(userId) ?? [], blocksOf.get(userId) ?? [], window),
    );
  }

  return verdicts;
}
