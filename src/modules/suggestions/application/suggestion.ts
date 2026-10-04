import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import {
  DECLINE_REASON_AREA,
  submitBlockers,
  triageBlockers,
  type SuggestionAreaValue,
  type SuggestionSourceValue,
  type SuggestionStatusValue,
} from '../domain/suggestion';

/**
 * Module 18, step 9.5 — what people said did not work.
 *
 * Two sources feed it: somebody typing one, and a decline reason from step
 * 6.5. The assignments doc has said since Stage 6 that "the pilot's
 * suggestion log is built from exactly this", and `recordDeclineAsSuggestion`
 * is the line that makes that true rather than aspirational.
 */

export const SuggestionErrors = {
  notFound: () => new HttpError('suggestion_not_found', 'That suggestion does not exist.', 404),

  cannotSubmit: (blockers: string[]) =>
    new HttpError('suggestion_cannot_submit', `This cannot be filed: ${blockers.join(', ')}.`, 422),

  cannotTriage: (blockers: string[]) =>
    new HttpError('suggestion_cannot_triage', `This cannot be triaged: ${blockers.join(', ')}.`, 409),
};

/** A queue row: the view, plus the author's name where there is an author. */
export interface SuggestionItem extends SuggestionView {
  raisedByName: string | null;
}

export interface SuggestionView {
  id: string;
  source: SuggestionSourceValue;
  raisedBy: string | null;
  area: SuggestionAreaValue;
  body: string;
  sourceRef: string | null;
  status: SuggestionStatusValue;
  triagedBy: string | null;
  triagedAt: Date | null;
  response: string | null;
  createdAt: Date;
}

interface Row extends Omit<SuggestionView, 'source' | 'area' | 'status'> {
  source: string;
  area: string;
  status: string;
}

function toView(row: Row): SuggestionView {
  return {
    id: row.id,
    source: row.source as SuggestionSourceValue,
    raisedBy: row.raisedBy,
    area: row.area as SuggestionAreaValue,
    body: row.body,
    sourceRef: row.sourceRef,
    status: row.status as SuggestionStatusValue,
    triagedBy: row.triagedBy,
    triagedAt: row.triagedAt,
    response: row.response,
    createdAt: row.createdAt,
  };
}

export async function submitSuggestion(input: {
  userId: string;
  area: SuggestionAreaValue;
  body: string;
}): Promise<SuggestionView> {
  const blockers = submitBlockers({ body: input.body });
  if (blockers.length > 0) throw SuggestionErrors.cannotSubmit(blockers);

  return prisma.$transaction(async (tx: Tx) => {
    const row = await tx.suggestion.create({
      data: {
        source: 'USER',
        raisedBy: input.userId,
        area: input.area,
        body: input.body,
      },
    });

    await recordAudit(tx, {
      action: 'suggestion.submitted',
      entityType: 'suggestions.suggestions',
      entityId: row.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      after: { area: row.area, status: row.status },
    });

    return toView(row);
  });
}

/**
 * Turns an invitation decline into a suggestion.
 *
 * **The practitioner is not recorded as the author.** They were answering an
 * invitation, not filing a suggestion, and attributing it to them would be
 * putting words in their mouth — as well as making a candid decline reason
 * something with their name on it in an operations queue. The invitation id
 * goes in `sourceRef` so the two can still be joined by somebody who needs to.
 *
 * Called from matching's decline path, which passes its own transaction so a
 * decline and its suggestion are one write or neither.
 */
export async function recordDeclineAsSuggestion(
  tx: Tx,
  input: { invitationId: string; reason: string },
): Promise<void> {
  if (submitBlockers({ body: input.reason }).length > 0) return;

  const row = await tx.suggestion.create({
    data: {
      source: 'DECLINE_REASON',
      area: DECLINE_REASON_AREA,
      body: input.reason,
      sourceRef: input.invitationId,
    },
  });

  // No actorId, for the same reason the row has no author: nobody filed
  // this. The decline it came from is audited under its own actor, and
  // putting that name here too would say they did something they did not.
  await recordAudit(tx, {
    action: 'suggestion.derived_from_decline',
    entityType: 'suggestions.suggestions',
    entityId: row.id,
    scopeType: 'PLATFORM',
    after: { source: row.source, area: row.area, sourceRef: row.sourceRef },
  });
}

export interface TriageParams {
  suggestionId: string;
  actorId: string;
  status: SuggestionStatusValue;
  response?: string;
}

/**
 * Moves a suggestion along, and answers it when it is finished with.
 *
 * `DONE` and `DECLINED` both need a written response; `TRIAGED` and `PLANNED`
 * do not. Moving something along the queue is housekeeping; telling somebody
 * their suggestion is finished with is an answer.
 */
export async function triageSuggestion(input: TriageParams): Promise<SuggestionView> {
  const existing = await prisma.suggestion.findUnique({ where: { id: input.suggestionId } });
  if (!existing) throw SuggestionErrors.notFound();

  const blockers = triageBlockers({
    status: existing.status as SuggestionStatusValue,
    next: input.status,
    response: input.response ?? '',
  });
  if (blockers.length > 0) throw SuggestionErrors.cannotTriage(blockers);

  return prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.suggestion.updateMany({
      where: { id: existing.id, status: existing.status },
      data: {
        status: input.status,
        triagedBy: input.actorId,
        triagedAt: new Date(),
        response: input.response ?? existing.response,
      },
    });
    if (applied.count !== 1) throw SuggestionErrors.cannotTriage(['already_closed']);

    const row = await tx.suggestion.findUniqueOrThrow({ where: { id: existing.id } });

    await recordAudit(tx, {
      action: 'suggestion.triaged',
      entityType: 'suggestions.suggestions',
      entityId: row.id,
      actorId: input.actorId,
      scopeType: 'PLATFORM',
      reason: input.response,
      before: { status: existing.status },
      after: { status: row.status },
    });

    return toView(row);
  });
}

export async function getSuggestion(suggestionId: string): Promise<SuggestionView> {
  const row = await prisma.suggestion.findUnique({ where: { id: suggestionId } });
  if (!row) throw SuggestionErrors.notFound();
  return toView(row);
}

export interface SuggestionQueuePage {
  suggestions: SuggestionItem[];
  nextCursor: string | null;
}

/**
 * The log, newest first, optionally narrowed and paged.
 *
 * Readable by area rather than only by date, because the thing a pilot needs
 * to see is not "what came in on Tuesday" but "eleven people have now said
 * the same thing about matching".
 *
 * Paged, where it once was not: a log fed by a walkthrough script that runs
 * every day for months is not the handful of rows a pilot's actual users
 * leave, and a page rendering all of them as open textareas at once was the
 * result. `limit` defaults so a direct call — a test, say — keeps working
 * without naming one.
 */
export async function listSuggestions(
  filter: {
    status?: SuggestionStatusValue;
    area?: SuggestionAreaValue;
    limit?: number;
    cursor?: string;
  } = {},
): Promise<SuggestionQueuePage> {
  const limit = filter.limit ?? 25;
  const rows = await prisma.suggestion.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.area ? { area: filter.area } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
  });

  const page = rows.slice(0, limit);
  return {
    suggestions: await withAuthors(page.map(toView)),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/**
 * Puts a name against the suggestions that have an author, and only those.
 *
 * **A decline reason has no author and must not acquire one.** Those rows are
 * created with no `raisedBy` at all — see `recordDeclineAsSuggestion`, which
 * writes its audit entry without an actor for the same reason — because the
 * practitioner was answering an invitation, not filing a complaint, and
 * naming them would report them as having done something they did not do.
 *
 * So the privacy decision lives in the data rather than in this function:
 * there is no id here to resolve, and nothing downstream has to remember the
 * rule. What this adds is a name for the people who *did* choose to write
 * something, because somebody answering a suggestion should know whether they
 * are replying to a nurse or to a hospital's administrator.
 */
async function withAuthors(views: SuggestionView[]): Promise<SuggestionItem[]> {
  const ids = [...new Set(views.map((view) => view.raisedBy).filter((id): id is string => Boolean(id)))];

  const people = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
    : [];
  const names = new Map(people.map((person) => [person.id, person.fullName]));

  return views.map((view) => ({
    ...view,
    raisedByName: view.raisedBy ? (names.get(view.raisedBy) ?? null) : null,
  }));
}

export interface AreaCount {
  area: SuggestionAreaValue;
  total: number;
  open: number;
}

/**
 * How many, by area, and how many still open.
 *
 * The single most useful view of a pilot log and the reason the `area` column
 * exists: a founder deciding what to fix next needs the shape of the
 * complaints, not the complaints themselves.
 */
export async function suggestionsByArea(): Promise<AreaCount[]> {
  const grouped = await prisma.suggestion.groupBy({
    by: ['area', 'status'],
    _count: { _all: true },
  });

  const totals = new Map<string, { total: number; open: number }>();
  for (const row of grouped) {
    const entry = totals.get(row.area) ?? { total: 0, open: 0 };
    entry.total += row._count._all;
    if (row.status !== 'DONE' && row.status !== 'DECLINED') entry.open += row._count._all;
    totals.set(row.area, entry);
  }

  return [...totals.entries()]
    .map(([area, counts]) => ({ area: area as SuggestionAreaValue, ...counts }))
    .sort((a, b) => b.total - a.total);
}
