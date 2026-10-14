import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/practitioners/application/bookable', () => import('./support/always-bookable'));

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

// The provider this file is about. Set on the object every module in this file reads,
// because configuration is parsed once, before a test file's own code runs.
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get: (target, key) => (key === 'PAYMENT_PROVIDER' ? 'manual' : Reflect.get(target, key)),
    }),
  };
});

import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import { POST as cancelRoute } from '@/app/api/v1/payouts/[id]/cancel/route';
import { POST as failRoute } from '@/app/api/v1/payouts/[id]/fail/route';
import { POST as settleRoute } from '@/app/api/v1/payouts/[id]/settle/route';
import {
  generateInvoice,
  issueInvoice,
  recordPayment,
} from '@/modules/billing-settlement/application/invoice';
import {
  amountOwed,
  cancelPayout,
  failPayout,
  preparePayout,
  releasePayout,
  settlePayout,
} from '@/modules/billing-settlement/application/payout';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { approved, buildWorld, type World } from './support/dispute-world';
import { createUser, grant } from './support/fixtures';

/**
 * BIL-05. Outside local there was no setting under which a payout could complete:
 * `console` stopped the boot, `none`, `paystack` and `remita` threw, and every
 * release left a FAILED payout. The pilot had no way to pay a practitioner at all.
 *
 * Paying by hand is how a pilot actually runs before a gateway exists: finance
 * releases the payout, makes the bank transfer outside the platform, and records
 * the bank's reference and date here, which is what completes it. Releasing moves
 * no money and writes no ledger entry; recording the transfer does.
 */

const PERIOD_START = new Date(Date.now() - 30 * 86_400_000);
const PERIOD_END = new Date(Date.now() + 30 * 86_400_000);
const GROSS = 4_000_000;
const lagosToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);

const COLLECTION = 'PAYOUT_REQUIRES_COLLECTION';
const SECOND = 'PAYOUT_SECOND_APPROVER';
const saved = { collection: process.env[COLLECTION], second: process.env[SECOND] };

beforeEach(() => {
  clearCookies();
  // Not what these cases are about: the money is collected, and one person may do it all.
  process.env[COLLECTION] = 'off';
  process.env[SECOND] = 'off';
});
afterAll(() => {
  for (const [key, value] of [[COLLECTION, saved.collection], [SECOND, saved.second]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function finance() {
  const user = await createUser({ fullName: 'Finance Officer' });
  await grant({ userId: user.id, roleKey: 'finance_manual', permissions: ['payout.manage', 'invoice.read'], scopeType: 'PLATFORM' });
  return user;
}

async function released() {
  const world: World = await buildWorld();
  await approved(world);
  const officer = await finance();
  const draft = await generateInvoice({ facilityId: world.facilityId, periodStart: PERIOD_START, periodEnd: PERIOD_END, actorId: officer.id });
  await issueInvoice({ invoiceId: draft.id, actorId: officer.id });
  await recordPayment({
    invoiceId: draft.id,
    actorId: officer.id,
    reference: 'FBN/TRF/0042',
    amountKobo: draft.grossKobo,
    paidOn: lagosToday(),
    payerName: 'The hospital',
  });
  const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });
  const sent = await releasePayout({ payoutId: payout.id, actorId: officer.id });
  return { world, officer, payout, sent };
}

const row = (id: string) => prisma.payout.findUniqueOrThrow({ where: { id } });
const entries = (payoutId: string) => prisma.ledgerEntry.findMany({ where: { payoutId } });

describe('releasing a payout by hand', () => {
  it('hands it to finance to transfer, and moves nothing', async () => {
    const { world, payout, sent } = await released();

    expect(sent.status).toBe('RELEASED');
    expect(sent.providerReference).toBeNull();
    expect(await entries(payout.id)).toHaveLength(0);
    // Still owed: nothing has gone to the bank yet.
    expect(await amountOwed(world.practitionerId)).toBe(GROSS);
    expect(await prisma.outboxEvent.count({ where: { eventType: EVENTS.PayoutSettled } })).toBe(0);
  });
});

describe('recording the transfer', () => {
  it('completes it with the bank\'s reference and date, writes the ledger and tells the practitioner', async () => {
    const { world, officer, payout } = await released();

    const done = await settlePayout({
      payoutId: payout.id,
      actorId: officer.id,
      bankReference: 'GTB/OUT/55120',
      paidOn: lagosToday(),
    });

    expect(done).toMatchObject({ status: 'SETTLED', providerReference: 'GTB/OUT/55120' });
    expect(await entries(payout.id)).toHaveLength(2);
    expect(await amountOwed(world.practitionerId)).toBe(0);
    const events = await prisma.outboxEvent.findMany({ where: { eventType: EVENTS.PayoutSettled } });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ userId: world.practitionerId, reference: 'GTB/OUT/55120', amountKobo: GROSS });
  });

  it('keeps the ledger balanced, and the cash account at zero once collected money has gone out', async () => {
    const { officer, payout } = await released();
    await settlePayout({ payoutId: payout.id, actorId: officer.id, bankReference: 'GTB/OUT/55120', paidOn: lagosToday() });

    const all = await prisma.ledgerEntry.aggregate({ _sum: { amountKobo: true } });
    const cash = await prisma.ledgerEntry.aggregate({ where: { account: 'CASH' }, _sum: { amountKobo: true } });
    expect(all._sum.amountKobo).toBe(0);
    expect(cash._sum.amountKobo).toBe(0);
  });

  it('needs the reference, and a date that is real, not in the future and not before it was released', async () => {
    const { officer, payout } = await released();
    const tomorrow = new Date(Date.now() + 3600_000 + 86_400_000).toISOString().slice(0, 10);
    const base = { payoutId: payout.id, actorId: officer.id, bankReference: 'GTB/OUT/55120', paidOn: lagosToday() };

    await expect(settlePayout({ ...base, bankReference: ' ' })).rejects.toMatchObject({ code: 'transfer_invalid' });
    await expect(settlePayout({ ...base, paidOn: tomorrow })).rejects.toMatchObject({ code: 'transfer_invalid' });
    await expect(settlePayout({ ...base, paidOn: '13/10/2026' })).rejects.toMatchObject({ code: 'transfer_invalid' });
    await expect(settlePayout({ ...base, paidOn: '2020-01-01' })).rejects.toMatchObject({ code: 'transfer_invalid' });
    expect((await row(payout.id)).status).toBe('RELEASED');
    expect(await entries(payout.id)).toHaveLength(0);
  });

  it('cannot be recorded twice: two people recording at once leave one set of entries', async () => {
    const { officer, payout } = await released();
    const input = { payoutId: payout.id, actorId: officer.id, bankReference: 'GTB/OUT/55120', paidOn: lagosToday() };

    const results = await Promise.allSettled([settlePayout(input), settlePayout(input)]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await entries(payout.id)).toHaveLength(2);
  });

  it('is only for a payout that has been released', async () => {
    const world: World = await buildWorld();
    await approved(world);
    const officer = await finance();
    const draft = await generateInvoice({ facilityId: world.facilityId, periodStart: PERIOD_START, periodEnd: PERIOD_END, actorId: officer.id });
    await issueInvoice({ invoiceId: draft.id, actorId: officer.id });
    const prepared = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });

    await expect(
      settlePayout({ payoutId: prepared.id, actorId: officer.id, bankReference: 'GTB/OUT/1', paidOn: lagosToday() }),
    ).rejects.toMatchObject({ code: 'payout_wrong_status' });
  });

  it('writes an audit row with the reference kept out, since a bank reference often names a person', async () => {
    const { officer, payout } = await released();

    await settlePayout({ payoutId: payout.id, actorId: officer.id, bankReference: 'TRF TO AMINA YUSUF', paidOn: lagosToday() });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'payout.settled' } });
    expect(JSON.stringify(audit)).not.toContain('AMINA');
    expect(JSON.stringify(audit)).toContain(lagosToday());
  });
});

describe('a transfer that did not go through', () => {
  it('is recorded as failed with the reason, frees the balance and writes nothing to the ledger', async () => {
    const { world, officer, payout } = await released();

    const failed = await failPayout({ payoutId: payout.id, actorId: officer.id, reason: 'The bank rejected the account number.' });

    expect(failed).toMatchObject({ status: 'FAILED', failureReason: 'The bank rejected the account number.' });
    expect(await entries(payout.id)).toHaveLength(0);
    // It can be prepared again, because nothing is in flight now.
    const again = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });
    expect(again.amountKobo).toBe(GROSS);
  });

  it('needs a reason, and is only for a payout that has been released', async () => {
    const { officer, payout } = await released();

    await expect(failPayout({ payoutId: payout.id, actorId: officer.id, reason: '  ' })).rejects.toMatchObject({ code: 'payout_reason_required' });
    await failPayout({ payoutId: payout.id, actorId: officer.id, reason: 'The bank rejected the account number.' });
    await expect(failPayout({ payoutId: payout.id, actorId: officer.id, reason: 'Again' })).rejects.toMatchObject({ code: 'payout_wrong_status' });
  });
});

describe('changing one\'s mind before releasing', () => {
  it('cancels a prepared payout, which frees the balance', async () => {
    const world: World = await buildWorld();
    await approved(world);
    const officer = await finance();
    const draft = await generateInvoice({ facilityId: world.facilityId, periodStart: PERIOD_START, periodEnd: PERIOD_END, actorId: officer.id });
    await issueInvoice({ invoiceId: draft.id, actorId: officer.id });
    const prepared = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });

    const cancelled = await cancelPayout({ payoutId: prepared.id, actorId: officer.id, reason: 'Prepared for the wrong month.' });

    expect(cancelled.status).toBe('CANCELLED');
    expect((await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id })).amountKobo).toBe(GROSS);
  });

  it('will not cancel one that has been released or paid: those are failed or settled', async () => {
    const { officer, payout } = await released();

    await expect(cancelPayout({ payoutId: payout.id, actorId: officer.id, reason: 'Changed my mind.' })).rejects.toMatchObject({ code: 'payout_wrong_status' });
    await settlePayout({ payoutId: payout.id, actorId: officer.id, bankReference: 'GTB/OUT/55120', paidOn: lagosToday() });
    await expect(cancelPayout({ payoutId: payout.id, actorId: officer.id, reason: 'Changed my mind.' })).rejects.toMatchObject({ code: 'payout_wrong_status' });
  });
});

describe('over the API', () => {
  const call = (route: (request: Request, props: { params: Promise<{ id: string }> }) => Promise<Response>, id: string, action: string, body: unknown) =>
    route(
      new Request(`http://localhost/api/v1/payouts/${id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );

  it('refuses all three on an ordinary session: they move money, so they ask for the password again', async () => {
    const { officer, payout } = await released();
    await issueSession({ userId: officer.id });

    expect((await call(settleRoute, payout.id, 'settle', { bankReference: 'X-1', paidOn: lagosToday() })).status).toBe(401);
    expect((await call(failRoute, payout.id, 'fail', { reason: 'Rejected by the bank.' })).status).toBe(401);
    expect((await call(cancelRoute, payout.id, 'cancel', { reason: 'Wrong month.' })).status).toBe(401);
    expect((await row(payout.id)).status).toBe('RELEASED');
  });

  it('settles a payout for somebody holding payout.manage, once the password is confirmed', async () => {
    const { officer, payout } = await released();
    await issueSession({ userId: officer.id, stepUp: true });

    const response = await call(settleRoute, payout.id, 'settle', { bankReference: 'GTB/OUT/55120', paidOn: lagosToday() });

    expect(response.status).toBe(200);
    expect((await row(payout.id)).status).toBe('SETTLED');
  });

  it('refuses somebody who does not hold payout.manage', async () => {
    const { payout } = await released();
    const bystander = await createUser({ fullName: 'Bystander' });
    await issueSession({ userId: bystander.id, stepUp: true });

    expect((await call(settleRoute, payout.id, 'settle', { bankReference: 'GTB/OUT/55120', paidOn: lagosToday() })).status).toBe(403);
    expect((await row(payout.id)).status).toBe('RELEASED');
  });
});
