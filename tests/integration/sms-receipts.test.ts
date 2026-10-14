import { beforeEach, describe, expect, it, vi } from 'vitest';

const sms = vi.hoisted(() => ({ attempt: vi.fn() }));
vi.mock('@/lib/sms', () => ({
  attemptSms: sms.attempt,
  trySendSms: async (message: unknown) => {
    const attempt = await sms.attempt(message);
    return attempt.delivered ? attempt.result : null;
  },
}));

import { env } from '@/lib/env';
import { prisma } from '@/lib/db';
import { notify } from '@/modules/notifications/application/notify';
import { recordDeliveryReceipt } from '@/modules/notifications/application/receipts';
import { systemStatus } from '@/modules/audit-compliance/application/system-status';
import { POST as africasTalkingReceipt } from '@/app/api/v1/webhooks/sms/africastalking/route';
import { createUser } from './support/fixtures';

/**
 * M16-05: what a gateway took a message for, and what it said afterwards.
 *
 * A message used to be "sent" the moment a gateway accepted it, and nothing said which
 * gateway or whether the phone ever got it. Now the row names the gateway and its id for the
 * message, says when a second gateway had to take over, and carries what the gateway reported
 * once it knows.
 */

const taken = (provider: string, providerMessageId: string, failedOverFrom?: string) => ({
  delivered: true,
  result: { provider, providerMessageId, accepted: true },
  reason: null,
  ...(failedOverFrom ? { failedOverFrom } : {}),
});

beforeEach(() => {
  sms.attempt.mockReset();
});

async function sentTo(user: { id: string }, relatedId: string, attempt = taken('africastalking', 'ATXid_1')) {
  sms.attempt.mockResolvedValue(attempt);
  await notify({ userId: user.id, kind: 'offer.created', body: 'You have an offer.', relatedId });
  return prisma.notificationMessage.findFirstOrThrow({ where: { userId: user.id, relatedId } });
}

describe('recording which gateway carried a message', () => {
  it("keeps the gateway's name and its id for the message", async () => {
    const user = await createUser();

    const row = await sentTo(user, crypto.randomUUID(), taken('termii', 'm-77'));

    expect(row).toMatchObject({ provider: 'termii', providerMessageId: 'm-77', failedOverFrom: null });
    expect(row.deliveryStatus).toBeNull();
  });

  it('says when the first gateway failed and a second one took the message', async () => {
    const user = await createUser();

    const row = await sentTo(user, crypto.randomUUID(), taken('africastalking', 'ATXid_2', 'termii'));

    expect(row).toMatchObject({ provider: 'africastalking', failedOverFrom: 'termii' });
  });

  it('records no gateway for a message nobody took, and keeps the reason', async () => {
    const user = await createUser();
    sms.attempt.mockResolvedValue({ delivered: false, result: null, reason: 'termii: HTTP 503; africastalking: HTTP 500' });
    const relatedId = crypto.randomUUID();

    const outcome = await notify({ userId: user.id, kind: 'offer.created', body: 'x', relatedId });
    const row = await prisma.notificationMessage.findFirstOrThrow({ where: { userId: user.id, relatedId } });

    expect(outcome.sent).toBe(false);
    expect(row).toMatchObject({ provider: null, providerMessageId: null, sentAt: null });
    expect(row.failureReason).toMatch(/termii.*503.*africastalking.*500/);
  });

  it('puts the gateway on the same row when a failed message is retried and goes', async () => {
    const user = await createUser();
    const relatedId = crypto.randomUUID();
    sms.attempt.mockResolvedValueOnce({ delivered: false, result: null, reason: 'HTTP 503' });
    await notify({ userId: user.id, kind: 'offer.created', body: 'x', relatedId });

    sms.attempt.mockResolvedValueOnce(taken('africastalking', 'ATXid_3', 'termii'));
    await notify({ userId: user.id, kind: 'offer.created', body: 'x', relatedId });

    const rows = await prisma.notificationMessage.findMany({ where: { userId: user.id, relatedId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'africastalking', providerMessageId: 'ATXid_3', failedOverFrom: 'termii' });
  });
});

describe('recording what a gateway reported about a message', () => {
  it('marks the message delivered, with when it was reported', async () => {
    const user = await createUser();
    await sentTo(user, crypto.randomUUID(), taken('africastalking', 'ATXid_10'));

    const result = await recordDeliveryReceipt({
      provider: 'africastalking',
      providerMessageId: 'ATXid_10',
      outcome: 'DELIVERED',
    });

    expect(result).toEqual({ matched: true, status: 'DELIVERED' });
    const row = await prisma.notificationMessage.findFirstOrThrow({ where: { providerMessageId: 'ATXid_10' } });
    expect(row.deliveryStatus).toBe('DELIVERED');
    expect(row.deliveryReportedAt).toBeInstanceOf(Date);
  });

  it('records a failure after acceptance, with its code', async () => {
    const user = await createUser();
    await sentTo(user, crypto.randomUUID(), taken('africastalking', 'ATXid_11'));

    await recordDeliveryReceipt({
      provider: 'africastalking',
      providerMessageId: 'ATXid_11',
      outcome: 'FAILED',
      detail: 'UserInBlacklist',
    });

    const row = await prisma.notificationMessage.findFirstOrThrow({ where: { providerMessageId: 'ATXid_11' } });
    expect(row).toMatchObject({ deliveryStatus: 'FAILED', deliveryDetail: 'UserInBlacklist' });
  });

  it('ignores a report for a message it never sent, and one from a different gateway', async () => {
    const user = await createUser();
    await sentTo(user, crypto.randomUUID(), taken('termii', 'shared-id'));

    const unknown = await recordDeliveryReceipt({ provider: 'africastalking', providerMessageId: 'nobody', outcome: 'DELIVERED' });
    const wrongGateway = await recordDeliveryReceipt({ provider: 'africastalking', providerMessageId: 'shared-id', outcome: 'DELIVERED' });

    expect(unknown).toEqual({ matched: false, status: null });
    expect(wrongGateway).toEqual({ matched: false, status: null });
    const row = await prisma.notificationMessage.findFirstOrThrow({ where: { providerMessageId: 'shared-id' } });
    expect(row.deliveryStatus).toBeNull();
  });

  it('lets a progress report be followed by the outcome, and never goes back', async () => {
    const user = await createUser();
    await sentTo(user, crypto.randomUUID(), taken('africastalking', 'ATXid_12'));
    const record = (outcome: 'PENDING' | 'DELIVERED' | 'FAILED') =>
      recordDeliveryReceipt({ provider: 'africastalking', providerMessageId: 'ATXid_12', outcome });
    const status = async () =>
      (await prisma.notificationMessage.findFirstOrThrow({ where: { providerMessageId: 'ATXid_12' } })).deliveryStatus;

    await record('PENDING');
    expect(await status()).toBe('PENDING');
    await record('DELIVERED');
    expect(await status()).toBe('DELIVERED');
    // Reports arrive late and out of order: a delivered message stays delivered.
    await record('PENDING');
    await record('FAILED');
    expect(await status()).toBe('DELIVERED');
  });

  it('lets a failure be corrected by a later delivery, and a repeat change nothing', async () => {
    const user = await createUser();
    await sentTo(user, crypto.randomUUID(), taken('africastalking', 'ATXid_13'));
    const record = (outcome: 'DELIVERED' | 'FAILED') =>
      recordDeliveryReceipt({ provider: 'africastalking', providerMessageId: 'ATXid_13', outcome });

    await record('FAILED');
    await record('FAILED');
    await record('DELIVERED');
    await record('DELIVERED');

    const row = await prisma.notificationMessage.findFirstOrThrow({ where: { providerMessageId: 'ATXid_13' } });
    expect(row.deliveryStatus).toBe('DELIVERED');
  });
});

describe("the Africa's Talking delivery-report endpoint", () => {
  const SECRET = 'receipt-secret-for-the-tests-0123456789';
  const post = (fields: Record<string, string>, query = `?token=${SECRET}`) =>
    africasTalkingReceipt(
      new Request(`http://localhost/api/v1/webhooks/sms/africastalking${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      }),
    );

  beforeEach(() => {
    (env as { SMS_RECEIPT_SECRET?: string }).SMS_RECEIPT_SECRET = SECRET;
  });

  it('does not exist until a secret is set, so a deployment that has not chosen it exposes nothing', async () => {
    (env as { SMS_RECEIPT_SECRET?: string }).SMS_RECEIPT_SECRET = undefined;

    const response = await post({ id: 'x', status: 'Success' });

    expect(response.status).toBe(404);
  });

  it.each([
    ['no token', ''],
    ['a wrong token', '?token=not-the-secret'],
    ['a token that is a prefix of the secret', `?token=${SECRET.slice(0, 10)}`],
    ['an empty token', '?token='],
  ])('refuses %s and changes nothing', async (_label, query) => {
    const user = await createUser();
    await sentTo(user, crypto.randomUUID(), taken('africastalking', 'ATXid_20'));

    const response = await post({ id: 'ATXid_20', status: 'Success' }, query);

    expect(response.status).toBe(401);
    const row = await prisma.notificationMessage.findFirstOrThrow({ where: { providerMessageId: 'ATXid_20' } });
    expect(row.deliveryStatus).toBeNull();
  });

  it('records a report that carries the secret', async () => {
    const user = await createUser();
    await sentTo(user, crypto.randomUUID(), taken('africastalking', 'ATXid_21'));

    const response = await post({ id: 'ATXid_21', status: 'Success', phoneNumber: '+2348031234567' });

    expect(response.status).toBe(200);
    const row = await prisma.notificationMessage.findFirstOrThrow({ where: { providerMessageId: 'ATXid_21' } });
    expect(row.deliveryStatus).toBe('DELIVERED');
    expect(JSON.stringify(row)).not.toContain('2348031234567');
  });

  it('answers 200 for a message it has no record of, so the gateway does not keep retrying it', async () => {
    const response = await post({ id: 'unknown-message', status: 'Success' });

    expect(response.status).toBe(200);
  });

  it('answers 400 for a report it cannot read', async () => {
    const response = await post({ status: 'Teleported' });

    expect(response.status).toBe(400);
  });
});

describe('what the system status says about delivery', () => {
  beforeEach(async () => {
    await prisma.notificationMessage.deleteMany({});
    (env as { SMS_RECEIPT_SECRET?: string }).SMS_RECEIPT_SECRET = 'receipt-secret-for-the-tests-0123456789';
  });

  async function row(
    userId: string,
    fields: { sentMinutesAgo: number; deliveryStatus?: string; failedOverFrom?: string; provider?: string },
  ) {
    const sentAt = new Date(Date.now() - fields.sentMinutesAgo * 60_000);
    await prisma.notificationMessage.create({
      data: {
        userId,
        channel: 'sms',
        kind: 'offer.created',
        recipient: '+234803***567',
        body: 'x',
        sentAt,
        createdAt: sentAt,
        provider: fields.provider ?? 'africastalking',
        providerMessageId: `m-${Math.random()}`,
        deliveryStatus: fields.deliveryStatus ?? null,
        failedOverFrom: fields.failedOverFrom ?? null,
      },
    });
  }

  it('counts messages a second gateway had to take, ones reported failed, and ones still unconfirmed', async () => {
    const user = await createUser();
    await row(user.id, { sentMinutesAgo: 60, failedOverFrom: 'termii' });
    await row(user.id, { sentMinutesAgo: 60, deliveryStatus: 'FAILED' });
    await row(user.id, { sentMinutesAgo: 60, deliveryStatus: 'DELIVERED' });
    await row(user.id, { sentMinutesAgo: 60 }); // taken an hour ago, nothing reported
    await row(user.id, { sentMinutesAgo: 5 }); // too recent to expect a report

    const { messages } = await systemStatus();

    expect(messages).toEqual({ receiptsEnabled: true, failedOver24h: 1, failedAfterAccepted24h: 1, unconfirmed: 2 });
  });

  it('does not count what is older than a day', async () => {
    const user = await createUser();
    await row(user.id, { sentMinutesAgo: 60 * 30, failedOverFrom: 'termii', deliveryStatus: 'FAILED' });

    const { messages } = await systemStatus();

    expect(messages).toMatchObject({ failedOver24h: 0, failedAfterAccepted24h: 0, unconfirmed: 0 });
  });

  it('cannot say how many are unconfirmed when no gateway has been asked to report', async () => {
    (env as { SMS_RECEIPT_SECRET?: string }).SMS_RECEIPT_SECRET = undefined;
    const user = await createUser();
    await row(user.id, { sentMinutesAgo: 60 });

    const { messages } = await systemStatus();

    // Every message would be "unconfirmed", which says nothing; null says it cannot be known.
    expect(messages).toMatchObject({ receiptsEnabled: false, unconfirmed: null });
  });
});
