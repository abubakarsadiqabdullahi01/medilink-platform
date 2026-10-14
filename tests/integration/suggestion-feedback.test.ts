import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

const sms = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/sms', async () => (await import('./support/sms-double')).gatewayDouble(sms.send));

import { prisma } from '@/lib/db';
import { GET as getMine } from '@/app/api/v1/me/suggestions/route';
import {
  listMySuggestions,
  recordDeclineAsSuggestion,
  submitSuggestion,
  triageSuggestion,
} from '@/modules/suggestions/application/suggestion';
import { issueSession } from '@/modules/auth/application/session-service';
import { runOnce } from '@/worker/processor';
import { handlers } from '@/worker/handlers';
import { clearCookies } from './support/cookie-jar';
import { createUser } from './support/fixtures';

/**
 * M18 (SUG-01, SUG-02): a person who writes a suggestion can see what became of it, and is told
 * when it is answered.
 *
 * The form promised "The Medilink team reads every suggestion and replies to it", the reply was
 * written, and nothing carried it back: the author could not read their own suggestion's status
 * and was never told it had been answered.
 */

beforeEach(() => {
  clearCookies();
  sms.send.mockReset();
  sms.send.mockResolvedValue({ accepted: true, provider: 'test', providerMessageId: null });
});

const REPLY = 'We have added a reminder the day before, as you asked. Thank you for the idea.';

async function filed(authorId: string, body = 'The check-in screen is too slow on my phone.') {
  return submitSuggestion({ userId: authorId, area: 'ATTENDANCE', body });
}

async function deliver() {
  await prisma.outboxEvent.updateMany({
    where: { status: 'FAILED' },
    data: { availableAt: new Date(Date.now() - 1000) },
  });
  return runOnce({ handlers });
}

const answeredEvents = () => prisma.outboxEvent.findMany({ where: { eventType: 'suggestion.answered' } });

describe('what an author can read of their own suggestions', () => {
  it('lists theirs, newest first, with where each one stands and the reply', async () => {
    const author = await createUser();
    const officer = await createUser();
    const first = await filed(author.id, 'First: the offers page loads slowly.');
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await filed(author.id, 'Second: I would like a reminder the day before.');
    await triageSuggestion({ suggestionId: second.id, actorId: officer.id, status: 'DONE', response: REPLY });

    const mine = await listMySuggestions(author.id);

    expect(mine.map((item) => [item.id, item.status, item.response])).toEqual([
      [second.id, 'DONE', REPLY],
      [first.id, 'NEW', null],
    ]);
  });

  it('is nobody else’s', async () => {
    const mine = await createUser();
    const theirs = await createUser();
    await filed(mine.id, 'Mine: please add a dark mode for night shifts.');
    await filed(theirs.id, 'Theirs: the invoice page is confusing to me.');

    const list = await listMySuggestions(mine.id);

    expect(list.map((item) => item.body)).toEqual(['Mine: please add a dark mode for night shifts.']);
  });

  it('never includes a decline reason, which has no author and must not acquire one', async () => {
    const person = await createUser();
    await prisma.$transaction((tx) =>
      recordDeclineAsSuggestion(tx, { invitationId: crypto.randomUUID(), reason: 'The pay is too low for the distance.' }),
    );

    expect(await listMySuggestions(person.id)).toEqual([]);
  });

  it('says who answered nothing: no officer’s name or id, and nothing but what the author wrote and was told', async () => {
    const author = await createUser();
    const officer = await createUser({ fullName: 'Officer Okonkwo' });
    const suggestion = await filed(author.id);
    await triageSuggestion({ suggestionId: suggestion.id, actorId: officer.id, status: 'DECLINED', response: REPLY });

    const [item] = await listMySuggestions(author.id);

    expect(Object.keys(item!).sort()).toEqual(['answeredAt', 'area', 'body', 'createdAt', 'id', 'response', 'status']);
    expect(JSON.stringify(item)).not.toContain(officer.id);
    expect(JSON.stringify(item)).not.toContain('Okonkwo');
  });
});

describe('the route that lists them', () => {
  it('answers a signed-in caller with their own, and nothing of anybody else’s', async () => {
    const mine = await createUser();
    const theirs = await createUser();
    await filed(mine.id, 'Mine: a button for my usual availability would help.');
    await filed(theirs.id, 'Theirs: the earnings page needs a date filter.');
    await issueSession({ userId: mine.id });

    const response = await getMine(new Request('http://localhost/api/v1/me/suggestions'));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { suggestions: { body: string }[] };
    expect(body.suggestions.map((s) => s.body)).toEqual(['Mine: a button for my usual availability would help.']);
  });

  it('refuses somebody who is not signed in', async () => {
    const response = await getMine(new Request('http://localhost/api/v1/me/suggestions'));

    expect(response.status).toBe(401);
  });
});

describe('telling the author it has been answered', () => {
  it.each(['PLANNED', 'DONE', 'DECLINED'] as const)('publishes one event when it is %s', async (status) => {
    const author = await createUser();
    const officer = await createUser();
    const suggestion = await filed(author.id);

    await triageSuggestion({ suggestionId: suggestion.id, actorId: officer.id, status, response: REPLY });

    const events = await answeredEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ suggestionId: suggestion.id, userId: author.id, status });
  });

  it('does not carry what the author wrote or the reply, only that there is one', async () => {
    const author = await createUser();
    const officer = await createUser();
    const suggestion = await filed(author.id, 'A private worry about my supervisor at the ward.');
    await triageSuggestion({ suggestionId: suggestion.id, actorId: officer.id, status: 'DONE', response: REPLY });

    const [event] = await answeredEvents();

    expect(JSON.stringify(event!.payload)).not.toContain('supervisor');
    expect(JSON.stringify(event!.payload)).not.toContain('reminder');
  });

  it('says nothing for housekeeping: moving it to triaged is not an answer', async () => {
    const author = await createUser();
    const officer = await createUser();
    const suggestion = await filed(author.id);

    await triageSuggestion({ suggestionId: suggestion.id, actorId: officer.id, status: 'TRIAGED' });

    expect(await answeredEvents()).toHaveLength(0);
  });

  it('says nothing about one with no author', async () => {
    const officer = await createUser();
    await prisma.$transaction((tx) =>
      recordDeclineAsSuggestion(tx, { invitationId: crypto.randomUUID(), reason: 'The pay is too low for the distance.' }),
    );
    const derived = await prisma.suggestion.findFirstOrThrow({ where: { source: 'DECLINE_REASON' } });

    await triageSuggestion({ suggestionId: derived.id, actorId: officer.id, status: 'DONE', response: REPLY });

    expect(await answeredEvents()).toHaveLength(0);
  });

  it('texts the author what became of it, and not the reply, which is for the screen', async () => {
    const author = await createUser();
    const officer = await createUser();
    const suggestion = await filed(author.id);
    await triageSuggestion({ suggestionId: suggestion.id, actorId: officer.id, status: 'DECLINED', response: REPLY });

    await deliver();

    expect(sms.send).toHaveBeenCalledTimes(1);
    const text = sms.send.mock.calls[0]![0].body as string;
    expect(text).toMatch(/suggestion/i);
    expect(text).toMatch(/declined|not be taken forward|will not/i);
    expect(text).not.toContain(REPLY);
    const row = await prisma.notificationMessage.findFirstOrThrow({ where: { userId: author.id } });
    expect(row).toMatchObject({ kind: 'suggestion.answered', relatedId: suggestion.id });
  });

  it.each([
    ['PLANNED', /planned|going to/i],
    ['DONE', /done|made the change|added/i],
  ] as const)('words a %s answer so the author can tell which it is', async (status, wording) => {
    const author = await createUser();
    const officer = await createUser();
    const suggestion = await filed(author.id);
    await triageSuggestion({ suggestionId: suggestion.id, actorId: officer.id, status, response: REPLY });

    await deliver();

    expect(sms.send.mock.calls[0]![0].body).toMatch(wording);
  });

  it('retries when the text did not go, and does not text twice when it did', async () => {
    const author = await createUser();
    const officer = await createUser();
    const suggestion = await filed(author.id);
    await triageSuggestion({ suggestionId: suggestion.id, actorId: officer.id, status: 'DONE', response: REPLY });
    sms.send.mockRejectedValueOnce(new Error('gateway down'));

    await deliver();
    await deliver();
    await deliver();

    const sent = await prisma.notificationMessage.findMany({ where: { userId: author.id, sentAt: { not: null } } });
    expect(sent).toHaveLength(1);
  });
});
