import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

const sms = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/sms', async () => (await import('./support/sms-double')).gatewayDouble(sms.send));

import { prisma } from '@/lib/db';
import { GET as getInbox } from '@/app/api/v1/me/notifications/route';
import { POST as postRead } from '@/app/api/v1/me/notifications/read/route';
import { notify } from '@/modules/notifications/application/notify';
import { listInbox, markInboxRead } from '@/modules/notifications/application/inbox';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { createUser } from './support/fixtures';

/**
 * UXP-01. Nobody was told anything in the product itself: a practitioner learned
 * of an offer only by opening the page that lists offers, and with no SMS gateway
 * yet nothing else reaches anyone. The inbox is every message the platform sent
 * to the person, whether or not the text got through.
 */

beforeEach(() => {
  clearCookies();
  sms.send.mockReset();
  sms.send.mockResolvedValue({ accepted: true, provider: 'test', providerMessageId: null });
});

const tell = (userId: string, body: string, kind = 'shift.invited') =>
  notify({ userId, kind, body, relatedType: 'x', relatedId: '00000000-0000-0000-0000-000000000001' });

describe('what is in the inbox', () => {
  it('has what the platform sent, newest first', async () => {
    const user = await createUser();
    await tell(user.id, 'First message.');
    await new Promise((resolve) => setTimeout(resolve, 15));
    await tell(user.id, 'Second message.');

    const inbox = await listInbox(user.id);

    expect(inbox.items.map((item) => item.body)).toEqual(['Second message.', 'First message.']);
    expect(inbox.unread).toBe(2);
  });

  it('has a message the text never delivered, because the gateway refused it', async () => {
    sms.send.mockResolvedValue({ accepted: false, provider: 'test', providerMessageId: null });
    const user = await createUser();

    const outcome = await tell(user.id, 'You have a new offer.');

    expect(outcome.sent).toBe(false);
    const inbox = await listInbox(user.id);
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]!.body).toBe('You have a new offer.');
  });

  it('is the caller\'s own, and nobody else\'s', async () => {
    const mine = await createUser();
    const theirs = await createUser();
    await tell(mine.id, 'For me.');
    await tell(theirs.id, 'For them.');

    const inbox = await listInbox(mine.id);

    expect(inbox.items.map((item) => item.body)).toEqual(['For me.']);
    expect(inbox.unread).toBe(1);
  });

  it('does not carry the masked number or anything about delivery, only what a person reads', async () => {
    const user = await createUser();
    await tell(user.id, 'Hello.');

    const item = (await listInbox(user.id)).items[0]!;

    expect(Object.keys(item).sort()).toEqual(['body', 'createdAt', 'id', 'kind', 'readAt']);
  });

  it('is limited to the most recent, while still counting everything unread', async () => {
    const user = await createUser();
    for (let index = 0; index < 5; index += 1) await tell(user.id, `Message ${index}`);

    const inbox = await listInbox(user.id, { limit: 2 });

    expect(inbox.items).toHaveLength(2);
    expect(inbox.unread).toBe(5);
  });
});

describe('reading', () => {
  it('marks some as read and leaves the rest', async () => {
    const user = await createUser();
    await tell(user.id, 'One.');
    await tell(user.id, 'Two.');
    const [first] = (await listInbox(user.id)).items;

    const changed = await markInboxRead(user.id, { ids: [first!.id] });

    expect(changed).toBe(1);
    const after = await listInbox(user.id);
    expect(after.unread).toBe(1);
    expect(after.items.find((item) => item.id === first!.id)!.readAt).not.toBeNull();
  });

  it('marks all as read', async () => {
    const user = await createUser();
    await tell(user.id, 'One.');
    await tell(user.id, 'Two.');

    expect(await markInboxRead(user.id, { all: true })).toBe(2);

    expect((await listInbox(user.id)).unread).toBe(0);
  });

  it('cannot mark somebody else\'s message, even with its id', async () => {
    const mine = await createUser();
    const theirs = await createUser();
    await tell(theirs.id, 'Theirs.');
    const theirMessage = (await listInbox(theirs.id)).items[0]!;

    const changed = await markInboxRead(mine.id, { ids: [theirMessage.id] });

    expect(changed).toBe(0);
    expect((await listInbox(theirs.id)).unread).toBe(1);
  });

  it('does not move the time something was first read', async () => {
    const user = await createUser();
    await tell(user.id, 'One.');
    const [item] = (await listInbox(user.id)).items;
    await markInboxRead(user.id, { ids: [item!.id] });
    const firstRead = (await listInbox(user.id)).items[0]!.readAt;
    await new Promise((resolve) => setTimeout(resolve, 15));

    await markInboxRead(user.id, { all: true });

    expect((await listInbox(user.id)).items[0]!.readAt).toEqual(firstRead);
  });
});

describe('over the API', () => {
  const read = (body: unknown) =>
    postRead(
      new Request('http://localhost/api/v1/me/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  it('is told to sign in without a session, on both', async () => {
    expect((await getInbox(new Request('http://localhost/api/v1/me/notifications'))).status).toBe(401);
    expect((await read({ all: true })).status).toBe(401);
  });

  it('gives a signed-in person their own messages and unread count, whatever they hold', async () => {
    const user = await createUser();
    const other = await createUser();
    await tell(user.id, 'For me.');
    await tell(other.id, 'Not for me.');
    await issueSession({ userId: user.id });

    const response = await getInbox(new Request('http://localhost/api/v1/me/notifications'));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { body: string }[]; unread: number };
    expect(body.items.map((item) => item.body)).toEqual(['For me.']);
    expect(body.unread).toBe(1);
  });

  it('ignores a user id in the query: the inbox is the session\'s, never a parameter\'s', async () => {
    const user = await createUser();
    const other = await createUser();
    await tell(other.id, 'Not for me.');
    await issueSession({ userId: user.id });

    const response = await getInbox(
      new Request(`http://localhost/api/v1/me/notifications?userId=${other.id}`),
    );

    expect(((await response.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it('marks read through the route, and refuses a request that names nothing', async () => {
    const user = await createUser();
    await tell(user.id, 'One.');
    await issueSession({ userId: user.id });

    expect((await read({})).status).toBe(422);
    expect((await read({ all: true })).status).toBe(200);
    expect((await listInbox(user.id)).unread).toBe(0);
  });

  it('refuses an id that is not one', async () => {
    const user = await createUser();
    await issueSession({ userId: user.id });

    expect((await read({ ids: ['not-a-uuid'] })).status).toBe(422);
  });
});

describe('what an old message does to the count', () => {
  it('a message that existed before the inbox is read, so nobody opens it to a flood', async () => {
    // The migration stamps what already existed as read; this is the same rule
    // stated as data: a row with a read time is not unread.
    const user = await createUser();
    await prisma.notificationMessage.create({
      data: {
        userId: user.id,
        channel: 'sms',
        kind: 'shift.invited',
        recipient: '*******1234',
        body: 'Old.',
        readAt: new Date(),
      },
    });

    expect((await listInbox(user.id)).unread).toBe(0);
  });
});
