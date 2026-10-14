import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/practitioners/application/bookable', () => import('./support/always-bookable'));

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import {
  generateInvoice,
  issueInvoice,
  recordPayment,
} from '@/modules/billing-settlement/application/invoice';
import {
  amountOwed,
  failPayout,
  payoutPosition,
  preparePayout,
  releasePayout,
  settlePayout,
} from '@/modules/billing-settlement/application/payout';
import { clearCookies } from './support/cookie-jar';
import { approved, buildWorld, type World } from './support/dispute-world';
import { createUser, grant } from './support/fixtures';

/**
 * BIL-03 and the money half of BIL-02. A payout was sized from what a practitioner
 * is *owed*, which is what the facility has been billed, so the platform could pay
 * before it was paid. It is now sized from what has been *collected*: the credits
 * on invoices a facility has actually paid.
 *
 * The suite runs with the rule off (see support/env.ts) so the rest of the money
 * flow can be driven without paying every invoice first; these cases unset it.
 */

const SETTING = 'PAYOUT_REQUIRES_COLLECTION';
const original = process.env[SETTING];

const PERIOD_START = new Date(Date.now() - 30 * 86_400_000);
const PERIOD_END = new Date(Date.now() + 30 * 86_400_000);
const GROSS = 4_000_000;
const lagosToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);

beforeEach(() => {
  clearCookies();
  delete process.env[SETTING];
});
afterAll(() => {
  if (original === undefined) delete process.env[SETTING];
  else process.env[SETTING] = original;
});

async function finance() {
  const user = await createUser({ fullName: 'Finance Officer' });
  await grant({ userId: user.id, roleKey: 'finance_collection', permissions: ['payout.manage', 'invoice.read'], scopeType: 'PLATFORM' });
  return user;
}

/** A shift approved and invoiced to a facility, the credit in place and the invoice issued but not paid. */
async function billed() {
  const world: World = await buildWorld();
  await approved(world);
  const officer = await finance();
  const draft = await generateInvoice({
    facilityId: world.facilityId,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    actorId: officer.id,
  });
  const invoice = await issueInvoice({ invoiceId: draft.id, actorId: officer.id });
  return { world, officer, invoice };
}

const facilityPays = (invoice: { id: string; grossKobo: number }, officerId: string) =>
  recordPayment({
    invoiceId: invoice.id,
    actorId: officerId,
    reference: 'FBN/TRF/0042',
    amountKobo: invoice.grossKobo,
    paidOn: lagosToday(),
    payerName: 'The hospital',
  });

describe('a practitioner whose facility has not paid', () => {
  it('is owed the money but cannot be paid it', async () => {
    const { world, officer } = await billed();

    expect(await amountOwed(world.practitionerId)).toBe(GROSS);
    await expect(
      preparePayout({ practitionerId: world.practitionerId, actorId: officer.id }),
    ).rejects.toMatchObject({ code: 'nothing_collected', status: 409 });
    expect(await prisma.payout.count()).toBe(0);
  });

  it('is shown what is owed, what can be paid now, and what is waiting on the facility', async () => {
    const { world } = await billed();

    expect(await payoutPosition(world.practitionerId)).toMatchObject({
      owedKobo: GROSS,
      payableKobo: 0,
      awaitingKobo: GROSS,
    });
  });
});

describe('once the facility has paid', () => {
  it('can be paid, and the cash account never goes negative', async () => {
    const { world, officer, invoice } = await billed();
    await facilityPays(invoice, officer.id);
    const colleague = await finance();

    const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });
    await releasePayout({ payoutId: payout.id, actorId: colleague.id });

    expect(payout.amountKobo).toBe(GROSS);
    const cash = await prisma.ledgerEntry.aggregate({ where: { account: 'CASH' }, _sum: { amountKobo: true } });
    expect(cash._sum.amountKobo).toBe(0);
    expect(await amountOwed(world.practitionerId)).toBe(0);
  });

  it('is shown all of it as payable, and nothing waiting', async () => {
    const { world, officer, invoice } = await billed();
    await facilityPays(invoice, officer.id);

    expect(await payoutPosition(world.practitionerId)).toMatchObject({
      owedKobo: GROSS,
      payableKobo: GROSS,
      awaitingKobo: 0,
    });
  });

  it('is paid only for what has arrived when another invoice of theirs is still unpaid', async () => {
    const { world, officer, invoice } = await billed();
    await facilityPays(invoice, officer.id);
    // A second credit for the same practitioner on an invoice nobody has paid.
    const OTHER = 1_500_000;
    const unpaidInvoiceId = randomUUID();
    const transactionId = randomUUID();
    await prisma.ledgerEntry.createMany({
      data: [
        { transactionId, account: 'FACILITY_PAYABLE', amountKobo: OTHER, subjectId: world.facilityId, memo: 'Approved shift', invoiceId: unpaidInvoiceId },
        { transactionId, account: 'PRACTITIONER_EARNINGS', amountKobo: -OTHER, subjectId: world.practitionerId, memo: 'Approved shift', invoiceId: unpaidInvoiceId },
      ],
    });

    expect(await payoutPosition(world.practitionerId)).toMatchObject({
      owedKobo: GROSS + OTHER,
      payableKobo: GROSS,
      awaitingKobo: OTHER,
    });
    const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });
    expect(payout.amountKobo).toBe(GROSS);
  });

  it('is not paid twice: what is already in flight is not payable again', async () => {
    const { world, officer, invoice } = await billed();
    await facilityPays(invoice, officer.id);
    await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });

    await expect(
      preparePayout({ practitionerId: world.practitionerId, actorId: officer.id }),
    ).rejects.toMatchObject({ code: 'nothing_owed' });
  });
});

describe('the rule itself', () => {
  it('can be turned off on purpose, and then a payout is sized from what is owed as before', async () => {
    const { world, officer } = await billed();
    process.env[SETTING] = 'off';

    const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });

    expect(payout.amountKobo).toBe(GROSS);
  });

  it('is on for anything but the word off, so a typo does not remove the control', async () => {
    const { world, officer } = await billed();
    process.env[SETTING] = 'false';

    await expect(
      preparePayout({ practitionerId: world.practitionerId, actorId: officer.id }),
    ).rejects.toMatchObject({ code: 'nothing_collected' });
  });

  it('is checked again at release, so a payout prepared before it was on cannot be released without cash', async () => {
    const { world, officer } = await billed();
    process.env[SETTING] = 'off';
    const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });
    delete process.env[SETTING];
    const colleague = await finance();

    await expect(
      releasePayout({ payoutId: payout.id, actorId: colleague.id }),
    ).rejects.toMatchObject({ code: 'nothing_collected' });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe('PREPARED');
  });
});

describe('recording a transfer by hand while a gateway is in charge', () => {
  // The provider here is the one the suite runs with, not `manual`. A payout a gateway
  // is processing is settled or failed by the gateway; a person recording a transfer
  // as well would have the practitioner paid twice.
  it('is refused, and leaves the payout as it was', async () => {
    const { world, officer, invoice } = await billed();
    await facilityPays(invoice, officer.id);
    const payout = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });
    await prisma.payout.update({ where: { id: payout.id }, data: { status: 'RELEASED', releasedAt: new Date() } });

    await expect(
      settlePayout({ payoutId: payout.id, actorId: officer.id, bankReference: 'GTB/OUT/1', paidOn: lagosToday() }),
    ).rejects.toMatchObject({ code: 'payout_not_by_hand', status: 409 });
    await expect(
      failPayout({ payoutId: payout.id, actorId: officer.id, reason: 'The bank rejected it.' }),
    ).rejects.toMatchObject({ code: 'payout_not_by_hand' });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe('RELEASED');
    expect(await prisma.ledgerEntry.count({ where: { payoutId: payout.id } })).toBe(0);
  });
});
