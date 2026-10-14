import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/practitioners/application/bookable', () => import('./support/always-bookable'));

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

const sms = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/sms', async () => (await import('./support/sms-double')).gatewayDouble(sms.send));

import { prisma } from '@/lib/db';
import { GET as getMine, POST as postMine } from '@/app/api/v1/me/payout-account/route';
import { GET as getQueue } from '@/app/api/v1/payout-accounts/route';
import { GET as getForOfficer } from '@/app/api/v1/payout-accounts/practitioner/[id]/route';
import { POST as postReview } from '@/app/api/v1/payout-accounts/[id]/review/route';
import {
  generateInvoice,
  issueInvoice,
} from '@/modules/billing-settlement/application/invoice';
import {
  awaitingVerification,
  myPayoutAccount,
  payoutAccountsForOfficer,
  reviewPayoutAccount,
  submitPayoutAccount,
} from '@/modules/billing-settlement/application/payout-account';
import { payoutPosition, preparePayout, releasePayout } from '@/modules/billing-settlement/application/payout';
import { issueSession } from '@/modules/auth/application/session-service';
import { runOnce } from '@/worker/processor';
import { handlers } from '@/worker/handlers';
import { clearCookies } from './support/cookie-jar';
import { approved, buildWorld, type World } from './support/dispute-world';
import { createUser, grant } from './support/fixtures';

/**
 * BIL-06. There was no bank-account model: a payout had no destination, finance took
 * account details from wherever they were sent, and nothing checked that the account
 * belonged to the person being paid. A practitioner now gives an account, a finance
 * officer verifies it against the name the practitioner is registered under, and a
 * payout is made only to a verified one.
 *
 * The suite runs with the rule off (see support/env.ts) so the rest of the money flow
 * can be driven without an account for everybody; the payout cases here unset it.
 */

const REQUIRED = 'PAYOUT_REQUIRES_ACCOUNT';
const COOLING = 'PAYOUT_ACCOUNT_COOLING_HOURS';
const COLLECTION = 'PAYOUT_REQUIRES_COLLECTION';
const saved = { required: process.env[REQUIRED], cooling: process.env[COOLING], collection: process.env[COLLECTION] };

const PERIOD_START = new Date(Date.now() - 30 * 86_400_000);
const PERIOD_END = new Date(Date.now() + 30 * 86_400_000);
const NUMBER = '0123456789';

beforeEach(() => {
  clearCookies();
  sms.send.mockReset();
  sms.send.mockResolvedValue({ provider: 'test', providerMessageId: 'm-1', accepted: true });
  // Off for the whole file but for the cases about them: the account rule, its waiting
  // period, and the collection rule, none of which are what most of these are about.
  process.env[REQUIRED] = 'off';
  process.env[COOLING] = '0';
  process.env[COLLECTION] = 'off';
});
afterAll(() => {
  for (const [key, value] of [[REQUIRED, saved.required], [COOLING, saved.cooling], [COLLECTION, saved.collection]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function practitioner(fullName = 'Ngozi Eze') {
  const user = await createUser({ fullName });
  await grant({
    userId: user.id,
    roleKey: 'practitioner',
    permissions: ['payout.account.change', 'invoice.read'],
    scopeType: 'SELF',
    scopeId: user.id,
  });
  return user;
}

async function finance() {
  const user = await createUser({ fullName: 'Finance Officer' });
  await grant({ userId: user.id, roleKey: 'finance_accounts', permissions: ['payout.manage', 'invoice.read'], scopeType: 'PLATFORM' });
  return user;
}

const give = (userId: string, overrides: Partial<{ bankName: string; accountName: string; accountNumber: string }> = {}) =>
  submitPayoutAccount({
    userId,
    bankName: 'Guaranty Trust Bank',
    accountName: 'EZE NGOZI CHIDINMA',
    accountNumber: NUMBER,
    ...overrides,
  });

const rowOf = (id: string) => prisma.payoutAccount.findUniqueOrThrow({ where: { id } });

describe('giving an account', () => {
  it('keeps it pending until a person has checked it, and shows it back without the number', async () => {
    const user = await practitioner();

    const account = await give(user.id);

    expect(account).toMatchObject({ status: 'PENDING', bankName: 'Guaranty Trust Bank', last4: '6789' });
    expect(Object.keys(account)).not.toContain('accountNumber');
    expect(JSON.stringify(account)).not.toContain(NUMBER);
  });

  it('stores the number sealed, so a copy of the table does not hold it', async () => {
    const user = await practitioner();

    const account = await give(user.id);

    const row = await rowOf(account.id);
    expect(row.accountNumberSealed).not.toContain(NUMBER);
    expect(JSON.stringify(row)).not.toContain(NUMBER);
    expect(row.fingerprint).not.toContain(NUMBER);
  });

  it('refuses a number that is not ten digits, and a missing name or bank, naming which', async () => {
    const user = await practitioner();

    await expect(give(user.id, { accountNumber: '12345' })).rejects.toMatchObject({ code: 'account_invalid', status: 422 });
    await expect(give(user.id, { accountName: ' ' })).rejects.toMatchObject({ code: 'account_invalid' });
    await expect(give(user.id, { bankName: '' })).rejects.toMatchObject({ code: 'account_invalid' });
    expect(await prisma.payoutAccount.count()).toBe(0);
  });

  it('accepts a number written with spaces', async () => {
    const user = await practitioner();

    const account = await give(user.id, { accountNumber: '0123 456 789' });

    expect(account.last4).toBe('6789');
  });

  it('replaces what was waiting for a check, so there is only ever one waiting', async () => {
    const user = await practitioner();
    const first = await give(user.id);

    const second = await give(user.id, { accountNumber: '0987654321' });

    expect((await rowOf(first.id)).status).toBe('REPLACED');
    expect((await rowOf(second.id)).status).toBe('PENDING');
    expect(await prisma.payoutAccount.count({ where: { userId: user.id, status: 'PENDING' } })).toBe(1);
  });

  it('does not touch the verified account until the new one is verified', async () => {
    const user = await practitioner();
    const officer = await finance();
    const old = await give(user.id);
    await reviewPayoutAccount({ accountId: old.id, actorId: officer.id, decision: 'verify' });

    await give(user.id, { accountNumber: '0987654321' });

    expect((await rowOf(old.id)).status).toBe('VERIFIED');
  });

  it('leaves one pending and one verified per person, whatever the code does: the database holds it', async () => {
    const user = await practitioner();
    const base = {
      userId: user.id,
      bankName: 'GTB',
      accountName: 'EZE NGOZI',
      accountLast4: '6789',
      accountNumberSealed: 'x',
      fingerprint: 'y',
    };
    await prisma.payoutAccount.create({ data: { ...base, status: 'PENDING' } });
    await prisma.payoutAccount.create({ data: { ...base, status: 'VERIFIED' } });

    await expect(prisma.payoutAccount.create({ data: { ...base, status: 'PENDING' } })).rejects.toThrow();
    await expect(prisma.payoutAccount.create({ data: { ...base, status: 'VERIFIED' } })).rejects.toThrow();
  });

  it('writes an audit row without the number', async () => {
    const user = await practitioner();

    await give(user.id);

    const rows = await prisma.auditLog.findMany({ where: { action: 'payout_account.submitted' } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(NUMBER);
    expect(JSON.stringify(rows)).not.toContain('EZE NGOZI');
  });

  it('tells the practitioner by text that an account was added, so a stranger adding one is noticed', async () => {
    const user = await practitioner();
    const phone = user.phone;

    await give(user.id);
    await runOnce({ handlers });

    const sent = sms.send.mock.calls.map((call) => call[0] as { to: string; body: string }).filter((m) => m.to === phone);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain('6789');
    expect(sent[0]!.body).not.toContain(NUMBER);
  });
});

describe('verifying an account', () => {
  it('makes it the one that is paid to, and retires the one before it', async () => {
    const user = await practitioner();
    const officer = await finance();
    const old = await give(user.id);
    await reviewPayoutAccount({ accountId: old.id, actorId: officer.id, decision: 'verify' });
    const next = await give(user.id, { accountNumber: '0987654321' });

    const verified = await reviewPayoutAccount({ accountId: next.id, actorId: officer.id, decision: 'verify' });

    expect(verified.status).toBe('VERIFIED');
    expect((await rowOf(old.id)).status).toBe('REPLACED');
    expect(await prisma.payoutAccount.count({ where: { userId: user.id, status: 'VERIFIED' } })).toBe(1);
    expect((await rowOf(next.id)).reviewedBy).toBe(officer.id);
  });

  it('is refused when the name on the account is not the practitioner\'s, until somebody says why it is fine', async () => {
    const user = await practitioner('Ngozi Eze');
    const officer = await finance();
    const account = await give(user.id, { accountName: 'AMINA YUSUF' });

    await expect(
      reviewPayoutAccount({ accountId: account.id, actorId: officer.id, decision: 'verify' }),
    ).rejects.toMatchObject({ code: 'account_needs_override', status: 409 });
    expect((await rowOf(account.id)).status).toBe('PENDING');

    const verified = await reviewPayoutAccount({
      accountId: account.id,
      actorId: officer.id,
      decision: 'verify',
      overrideReason: 'Her sister holds the account; confirmed by phone with the bank.',
    });
    expect(verified.status).toBe('VERIFIED');
  });

  it('does not take an override reason that is not a reason', async () => {
    const user = await practitioner('Ngozi Eze');
    const officer = await finance();
    const account = await give(user.id, { accountName: 'AMINA YUSUF' });

    await expect(
      reviewPayoutAccount({ accountId: account.id, actorId: officer.id, decision: 'verify', overrideReason: 'ok' }),
    ).rejects.toMatchObject({ code: 'account_needs_override' });
  });

  it('is refused when another practitioner has given the same account, with or without a matching name', async () => {
    const officer = await finance();
    const first = await practitioner('Ngozi Eze');
    const second = await practitioner('Chidi Okafor');
    const original = await give(first.id);
    await reviewPayoutAccount({ accountId: original.id, actorId: officer.id, decision: 'verify' });
    const copy = await give(second.id, { accountName: 'OKAFOR CHIDI' });

    await expect(
      reviewPayoutAccount({ accountId: copy.id, actorId: officer.id, decision: 'verify' }),
    ).rejects.toMatchObject({ code: 'account_needs_override' });
  });

  it('records what was overridden and why, without the number', async () => {
    const user = await practitioner('Ngozi Eze');
    const officer = await finance();
    const account = await give(user.id, { accountName: 'AMINA YUSUF' });

    await reviewPayoutAccount({
      accountId: account.id,
      actorId: officer.id,
      decision: 'verify',
      overrideReason: 'Her sister holds the account; confirmed by phone with the bank.',
    });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'payout_account.verified' } });
    expect(JSON.stringify(audit)).toContain('name_mismatch');
    expect(JSON.stringify(audit)).toContain('sister');
    expect(JSON.stringify(audit)).not.toContain(NUMBER);
  });

  it('can be refused, with a reason the practitioner is sent', async () => {
    const user = await practitioner();
    const officer = await finance();
    const account = await give(user.id);

    await expect(
      reviewPayoutAccount({ accountId: account.id, actorId: officer.id, decision: 'reject', note: ' ' }),
    ).rejects.toMatchObject({ code: 'account_note_required' });
    const refused = await reviewPayoutAccount({
      accountId: account.id,
      actorId: officer.id,
      decision: 'reject',
      note: 'The bank says that number is closed.',
    });
    await runOnce({ handlers });

    expect(refused.status).toBe('REJECTED');
    const bodies = sms.send.mock.calls.map((call) => (call[0] as { body: string }).body);
    expect(bodies.some((body) => body.includes('closed'))).toBe(true);
  });

  it('is only for one that is waiting', async () => {
    const user = await practitioner();
    const officer = await finance();
    const account = await give(user.id);
    await reviewPayoutAccount({ accountId: account.id, actorId: officer.id, decision: 'verify' });

    await expect(
      reviewPayoutAccount({ accountId: account.id, actorId: officer.id, decision: 'verify' }),
    ).rejects.toMatchObject({ code: 'account_wrong_status' });
  });

  it('is verified once when two officers press verify at the same moment', async () => {
    const user = await practitioner();
    const officer = await finance();
    const other = await finance();
    const account = await give(user.id);

    const results = await Promise.allSettled([
      reviewPayoutAccount({ accountId: account.id, actorId: officer.id, decision: 'verify' }),
      reviewPayoutAccount({ accountId: account.id, actorId: other.id, decision: 'verify' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.payoutAccount.count({ where: { userId: user.id, status: 'VERIFIED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'payout_account.verified' } })).toBe(1);
  });
});

describe('seeing the account', () => {
  it('shows the practitioner their own, never the whole number', async () => {
    const user = await practitioner();
    const officer = await finance();
    const account = await give(user.id);
    await reviewPayoutAccount({ accountId: account.id, actorId: officer.id, decision: 'verify' });
    await give(user.id, { accountNumber: '0987654321' });

    const mine = await myPayoutAccount(user.id);

    expect(mine.verified).toMatchObject({ last4: '6789', status: 'VERIFIED' });
    expect(mine.pending).toMatchObject({ last4: '4321', status: 'PENDING' });
    expect(JSON.stringify(mine)).not.toContain(NUMBER);
    expect(JSON.stringify(mine)).not.toContain('0987654321');
  });

  it('shows a refusal, until another account is given', async () => {
    const user = await practitioner();
    const officer = await finance();
    const account = await give(user.id);
    await reviewPayoutAccount({ accountId: account.id, actorId: officer.id, decision: 'reject', note: 'That number is closed.' });

    expect((await myPayoutAccount(user.id)).refused).toMatchObject({ reviewNote: 'That number is closed.' });

    await give(user.id, { accountNumber: '0987654321' });
    expect((await myPayoutAccount(user.id)).refused).toBeNull();
  });

  it('shows finance the number they are to transfer to, and records that they looked', async () => {
    const user = await practitioner();
    const officer = await finance();
    const account = await give(user.id);

    const view = await payoutAccountsForOfficer({ practitionerId: user.id, actorId: officer.id });

    expect(view.practitionerName).toBe('Ngozi Eze');
    expect(view.accounts[0]).toMatchObject({ id: account.id, accountNumber: NUMBER, accountName: 'EZE NGOZI CHIDINMA' });
    const looked = await prisma.auditLog.findMany({ where: { action: 'payout_account.revealed' } });
    expect(looked).toHaveLength(1);
    expect(looked[0]!.actorId).toBe(officer.id);
    expect(JSON.stringify(looked)).not.toContain(NUMBER);
  });

  it('tells finance what is wrong with a waiting account before they verify it', async () => {
    const user = await practitioner('Ngozi Eze');
    const officer = await finance();
    await give(user.id, { accountName: 'AMINA YUSUF' });

    const view = await payoutAccountsForOfficer({ practitionerId: user.id, actorId: officer.id });

    expect(view.accounts[0]!.problems).toEqual(['name_mismatch']);
  });

  it('lists what is waiting for a check, newest last, without numbers', async () => {
    const officer = await finance();
    const first = await practitioner('Ngozi Eze');
    const second = await practitioner('Chidi Okafor');
    await give(first.id);
    await give(second.id, { accountName: 'OKAFOR CHIDI', accountNumber: '0987654321' });

    const queue = await awaitingVerification();

    expect(queue.map((row) => row.practitionerName)).toEqual(['Ngozi Eze', 'Chidi Okafor']);
    expect(JSON.stringify(queue)).not.toContain(NUMBER);
    expect(JSON.stringify(queue)).not.toContain('0987654321');
    void officer;
  });
});

describe('paying only to a verified account', () => {
  // The rule is on for these. They need money that has been collected, so the facility
  // is billed and its invoice recorded as paid; what is under test is the account.
  async function owed() {
    const world: World = await buildWorld();
    await approved(world);
    const officer = await finance();
    const draft = await generateInvoice({ facilityId: world.facilityId, periodStart: PERIOD_START, periodEnd: PERIOD_END, actorId: officer.id });
    await issueInvoice({ invoiceId: draft.id, actorId: officer.id });
    return { world, officer };
  }

  beforeEach(() => {
    delete process.env[REQUIRED];
  });

  it('refuses to prepare a payout for somebody who has given no account', async () => {
    const { world, officer } = await owed();

    await expect(
      preparePayout({ practitionerId: world.practitionerId, actorId: officer.id }),
    ).rejects.toMatchObject({ code: 'no_payout_account', status: 409 });
    expect(await prisma.payout.count()).toBe(0);
  });

  it('refuses while the account has been given and not yet verified', async () => {
    const { world, officer } = await owed();
    await give(world.practitionerId);

    await expect(
      preparePayout({ practitionerId: world.practitionerId, actorId: officer.id }),
    ).rejects.toMatchObject({ code: 'no_payout_account' });
  });

  it('prepares once it is verified, and records which account it is for', async () => {
    const { world, officer } = await owed();
    const account = await give(world.practitionerId, { accountName: 'EZE NGOZI' });
    await reviewPayoutAccount({ accountId: account.id, actorId: officer.id, decision: 'verify' });

    const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });

    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).accountId).toBe(account.id);
  });

  it('waits out the cooling-off period from when the account was given, not from when it was verified', async () => {
    const { world, officer } = await owed();
    process.env[COOLING] = '24';
    const account = await give(world.practitionerId);
    await reviewPayoutAccount({ accountId: account.id, actorId: officer.id, decision: 'verify' });

    await expect(
      preparePayout({ practitionerId: world.practitionerId, actorId: officer.id }),
    ).rejects.toMatchObject({ code: 'payout_account_cooling_off', status: 409 });

    await prisma.payoutAccount.update({
      where: { id: account.id },
      data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });
    expect(payout.amountKobo).toBeGreaterThan(0);
  });

  it('will not release a payout to an account that has been changed since it was prepared', async () => {
    const { world, officer } = await owed();
    const first = await give(world.practitionerId);
    await reviewPayoutAccount({ accountId: first.id, actorId: officer.id, decision: 'verify' });
    const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });
    const next = await give(world.practitionerId, { accountNumber: '0987654321' });
    await reviewPayoutAccount({ accountId: next.id, actorId: officer.id, decision: 'verify' });
    const colleague = await finance();

    await expect(
      releasePayout({ payoutId: payout.id, actorId: colleague.id }),
    ).rejects.toMatchObject({ code: 'payout_account_changed', status: 409 });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe('PREPARED');
  });

  it('can be turned off on purpose, and is on for anything but the word off', async () => {
    const { world, officer } = await owed();

    process.env[REQUIRED] = 'false';
    await expect(
      preparePayout({ practitionerId: world.practitionerId, actorId: officer.id }),
    ).rejects.toMatchObject({ code: 'no_payout_account' });

    process.env[REQUIRED] = 'off';
    const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });
    expect(payout.amountKobo).toBeGreaterThan(0);
  });

  it('says where a practitioner stands, so a screen can say why Prepare is not offered', async () => {
    const { world, officer } = await owed();
    expect((await payoutPosition(world.practitionerId)).account.state).toBe('missing');

    const account = await give(world.practitionerId);
    expect((await payoutPosition(world.practitionerId)).account.state).toBe('unverified');

    process.env[COOLING] = '24';
    await reviewPayoutAccount({ accountId: account.id, actorId: officer.id, decision: 'verify' });
    expect((await payoutPosition(world.practitionerId)).account.state).toBe('cooling_off');

    process.env[COOLING] = '0';
    expect((await payoutPosition(world.practitionerId)).account.state).toBe('ready');

    process.env[REQUIRED] = 'off';
    expect((await payoutPosition(world.practitionerId)).account.state).toBe('not_required');
  });
});

describe('over the API', () => {
  const post = (body: unknown) =>
    postMine(
      new Request('http://localhost/api/v1/me/payout-account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  const review = (id: string, body: unknown) =>
    postReview(
      new Request(`http://localhost/api/v1/payout-accounts/${id}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  const forOfficer = (id: string) =>
    getForOfficer(new Request(`http://localhost/api/v1/payout-accounts/practitioner/${id}`), {
      params: Promise.resolve({ id }),
    });
  const body = { bankName: 'Guaranty Trust Bank', accountName: 'EZE NGOZI CHIDINMA', accountNumber: NUMBER };

  it('asks for the password again before an account is given: it is where money will go', async () => {
    const user = await practitioner();
    await issueSession({ userId: user.id });

    expect((await post(body)).status).toBe(401);
    expect(await prisma.payoutAccount.count()).toBe(0);
  });

  it('takes an account for the person signed in, once the password is confirmed, and never says it back', async () => {
    const user = await practitioner();
    await issueSession({ userId: user.id, stepUp: true });

    const response = await post(body);

    expect(response.status).toBe(201);
    expect(JSON.stringify(await response.json())).not.toContain(NUMBER);
    expect((await prisma.payoutAccount.findFirstOrThrow()).userId).toBe(user.id);
  });

  it('is told to sign in without a session', async () => {
    expect((await post(body)).status).toBe(401);
    expect((await getMine(new Request('http://localhost/api/v1/me/payout-account'))).status).toBe(401);
  });

  it('shows the signed-in person their own account and nobody else\'s', async () => {
    const user = await practitioner();
    const other = await practitioner('Chidi Okafor');
    await give(user.id);
    await give(other.id, { accountNumber: '0987654321' });
    await issueSession({ userId: user.id });

    const response = await getMine(new Request(`http://localhost/api/v1/me/payout-account?userId=${other.id}`));

    const mine = (await response.json()) as { pending: { last4: string } };
    expect(mine.pending.last4).toBe('6789');
    expect(JSON.stringify(mine)).not.toContain('4321');
  });

  it('gives finance the number only for a fresh password, and refuses a practitioner outright', async () => {
    const user = await practitioner();
    const stranger = await practitioner('Chidi Okafor');
    const officer = await finance();
    await give(user.id);

    await issueSession({ userId: officer.id });
    expect((await forOfficer(user.id)).status).toBe(401);

    await issueSession({ userId: stranger.id, stepUp: true });
    expect((await forOfficer(user.id)).status).toBe(403);

    await issueSession({ userId: officer.id, stepUp: true });
    const response = await forOfficer(user.id);
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain(NUMBER);
  });

  it('lists what is waiting, masked, for somebody who can read invoices', async () => {
    const user = await practitioner();
    const officer = await finance();
    await give(user.id);
    await issueSession({ userId: officer.id });

    const response = await getQueue(new Request('http://localhost/api/v1/payout-accounts'));

    expect(response.status).toBe(200);
    const text = JSON.stringify(await response.json());
    expect(text).toContain('Ngozi Eze');
    expect(text).not.toContain(NUMBER);
  });

  it('refuses the queue to a practitioner', async () => {
    const user = await practitioner();
    await issueSession({ userId: user.id });

    expect((await getQueue(new Request('http://localhost/api/v1/payout-accounts'))).status).toBe(403);
  });

  it('verifies for somebody holding payout.manage with a fresh password, and refuses a practitioner doing it to themselves', async () => {
    const user = await practitioner();
    const officer = await finance();
    const account = await give(user.id);

    await issueSession({ userId: user.id, stepUp: true });
    expect((await review(account.id, { decision: 'verify' })).status).toBe(403);
    expect((await rowOf(account.id)).status).toBe('PENDING');

    await issueSession({ userId: officer.id });
    expect((await review(account.id, { decision: 'verify' })).status).toBe(401);

    await issueSession({ userId: officer.id, stepUp: true });
    expect((await review(account.id, { decision: 'verify' })).status).toBe(200);
    expect((await rowOf(account.id)).status).toBe('VERIFIED');
  });
});
