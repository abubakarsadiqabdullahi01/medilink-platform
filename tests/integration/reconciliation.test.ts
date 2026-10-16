import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/practitioners/application/bookable', () => import('./support/always-bookable'));

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

// Paying by hand, which is how a pilot runs: release hands the transfer to finance and recording
// it settles the payout. Set on the object every module in this file reads.
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
import { logger } from '@/lib/logger';
import { GET as reconciliationRoute } from '@/app/api/v1/finance/reconciliation/route';
import { issueSession } from '@/modules/auth/application/session-service';
import {
  generateInvoice,
  issueInvoice,
  recordPayment,
  voidInvoice,
} from '@/modules/billing-settlement/application/invoice';
import { preparePayout, releasePayout, settlePayout } from '@/modules/billing-settlement/application/payout';
import { reconcileLedger } from '@/modules/billing-settlement/application/reconciliation';
import { jobs, JOB_DEFINITIONS } from '@/worker/jobs';
import { runJob } from '@/worker/scheduler';
import { clearCookies } from './support/cookie-jar';
import { approved, buildWorld } from './support/dispute-world';
import { createUser, grant } from './support/fixtures';

/**
 * M12-07: does the money add up.
 *
 * The first cases use the money the ordinary way, all of it (a draft raised and voided, the
 * shift billed again, paid, the practitioner paid) and expect nothing. The rest damage the ledger
 * or the records in the ways the checks exist for, with writes the application would not make, and
 * expect each to be found, by what it is.
 */

const PERIOD_START = new Date(Date.now() - 30 * 86_400_000);
const PERIOD_END = new Date(Date.now() + 30 * 86_400_000);
const lagosToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);

const COLLECTION = 'PAYOUT_REQUIRES_COLLECTION';
const SECOND = 'PAYOUT_SECOND_APPROVER';

beforeEach(() => {
  clearCookies();
  // Not what these cases are about: the money is collected, and one person may do it all.
  process.env[COLLECTION] = 'off';
  process.env[SECOND] = 'off';
});

async function finance() {
  const user = await createUser({ fullName: 'Finance Officer' });
  await grant({ userId: user.id, roleKey: 'finance_manual', permissions: ['payout.manage', 'invoice.read'], scopeType: 'PLATFORM' });
  return user;
}

type Stage = 'draft' | 'issued' | 'paid' | 'released' | 'settled';

/**
 * One shift, billed the long way round: raised and voided, billed again, then taken as far as the
 * stage says: issued, paid, the practitioner's payout prepared and released, settled.
 */
async function ordinaryUse(stage: Stage = 'settled') {
  const reached = (wanted: Stage) =>
    ['draft', 'issued', 'paid', 'released', 'settled'].indexOf(stage) >= ['draft', 'issued', 'paid', 'released', 'settled'].indexOf(wanted);

  const world = await buildWorld();
  await approved(world);
  const officer = await finance();

  const first = await generateInvoice({ facilityId: world.facilityId, periodStart: PERIOD_START, periodEnd: PERIOD_END, actorId: officer.id });
  await voidInvoice({ invoiceId: first.id, actorId: officer.id, reason: 'Raised for the wrong month.' });
  const invoice = await generateInvoice({ facilityId: world.facilityId, periodStart: PERIOD_START, periodEnd: PERIOD_END, actorId: officer.id });

  if (reached('issued')) await issueInvoice({ invoiceId: invoice.id, actorId: officer.id });
  if (reached('paid')) {
    await recordPayment({
      invoiceId: invoice.id,
      actorId: officer.id,
      reference: 'FBN/TRF/0042',
      amountKobo: invoice.grossKobo,
      paidOn: lagosToday(),
      payerName: 'The hospital',
    });
  }

  let payout: Awaited<ReturnType<typeof preparePayout>> | null = null;
  if (reached('released')) {
    payout = await preparePayout({ practitionerId: world.practitionerId, actorId: officer.id });
    await releasePayout({ payoutId: payout.id, actorId: officer.id });
  }
  if (reached('settled') && payout) {
    await settlePayout({ payoutId: payout.id, actorId: officer.id, bankReference: 'GTB/OUT/55120', paidOn: lagosToday() });
  }
  return { world, officer, voided: first, invoice, payout: payout! };
}

const kindsOf = async (options?: Parameters<typeof reconcileLedger>[0]) =>
  (await reconcileLedger(options)).findings.map((finding) => finding.kind);

describe('money used the ordinary way', () => {
  it('adds up, all the way from a voided draft to a settled payout', async () => {
    await ordinaryUse();

    const report = await reconcileLedger();

    expect(report.findings).toEqual([]);
    // It looked at something: a check that found nothing in an empty ledger would say the same.
    expect(report.checked.transactions).toBeGreaterThanOrEqual(4);
    expect(report.checked.invoices).toBe(2);
    expect(report.checked.payouts).toBe(1);
  });

  it.each(['draft', 'issued', 'paid', 'released'] as const)(
    'adds up at every stage on the way: %s',
    async (stage) => {
      await ordinaryUse(stage);
      expect(await kindsOf()).toEqual([]);
    },
  );

  it('adds up when there is nothing yet', async () => {
    expect((await reconcileLedger()).findings).toEqual([]);
  });
});

describe('a ledger that has been damaged', () => {
  it('shows a transaction with one side missing, in the ledger and in the invoice it belonged to', async () => {
    const { payout } = await ordinaryUse();
    await prisma.ledgerEntry.deleteMany({ where: { payoutId: payout.id, account: 'CASH' } });

    const kinds = await kindsOf();

    expect(kinds).toContain('transaction_unbalanced');
    expect(kinds).toContain('ledger_not_zero');
    expect(kinds).toContain('payout_entries_differ');
  });

  it('shows an entry whose amount was changed, and by how much', async () => {
    const { invoice } = await ordinaryUse();
    await prisma.ledgerEntry.updateMany({
      where: { invoiceId: invoice.id, account: 'FACILITY_PAYABLE', amountKobo: { gt: 0 } },
      data: { amountKobo: { increment: 250 } },
    });

    const report = await reconcileLedger();

    const unbalanced = report.findings.find((finding) => finding.kind === 'transaction_unbalanced');
    expect(unbalanced).toMatchObject({ expectedKobo: 0, actualKobo: 250 });
    expect(report.findings.map((finding) => finding.kind)).toContain('ledger_not_zero');
  });

  it('shows an invoice marked paid with no payment behind it', async () => {
    const { invoice } = await ordinaryUse('released');
    // Both sides of the payment are removed, so every transaction still balances and only the
    // invoice, which says paid, is out of step with what the ledger shows.
    await prisma.ledgerEntry.deleteMany({ where: { invoiceId: invoice.id, memo: 'Invoice paid' } });

    const report = await reconcileLedger();

    expect(report.findings.map((finding) => finding.kind)).toEqual(['invoice_ledger_differs']);
    expect(report.findings[0]!.subject).toMatchObject({ type: 'invoice', id: invoice.id, label: invoice.number });
  });

  it('shows an invoice whose recorded payment is not the whole of it', async () => {
    const { invoice } = await ordinaryUse('paid');
    await prisma.invoice.update({ where: { id: invoice.id }, data: { paymentAmountKobo: invoice.grossKobo - 100 } });

    const report = await reconcileLedger();

    const kinds = report.findings.map((finding) => finding.kind);
    expect(kinds).toContain('payment_amount_differs');
    expect(report.findings.find((finding) => finding.kind === 'payment_amount_differs')).toMatchObject({
      expectedKobo: invoice.grossKobo,
      actualKobo: invoice.grossKobo - 100,
    });
  });

  it('shows an issued invoice that no longer owes what it says, though every transaction still balances', async () => {
    const { invoice } = await ordinaryUse('issued');
    await prisma.ledgerEntry.updateMany({
      where: { invoiceId: invoice.id, account: 'FACILITY_PAYABLE', amountKobo: { gt: 0 } },
      data: { amountKobo: { decrement: 1_000 } },
    });
    await prisma.ledgerEntry.updateMany({
      where: { invoiceId: invoice.id, account: 'PRACTITIONER_EARNINGS' },
      data: { amountKobo: { increment: 1_000 } },
    });

    const kinds = await kindsOf();

    // The transaction still balances: only the invoice, whose payable no longer matches it, shows it.
    expect(kinds).toContain('invoice_ledger_differs');
  });

  it('shows an invoice whose lines no longer come to what it says', async () => {
    const { invoice } = await ordinaryUse();
    await prisma.invoiceLine.updateMany({ where: { invoiceId: invoice.id, voidedAt: null }, data: { amountKobo: { increment: 100 } } });

    expect(await kindsOf()).toEqual(['invoice_lines_differ']);
  });

  it('shows a settled payout that has lost its entries, with both sides gone', async () => {
    const { payout } = await ordinaryUse();
    await prisma.ledgerEntry.deleteMany({ where: { payoutId: payout.id } });

    const kinds = await kindsOf();

    // Money went out and the ledger says it did not: the practitioner now looks owed it again.
    expect(kinds).toEqual(['payout_entries_differ']);
  });

  it('shows a payout that was never settled but has entries, as if money had gone', async () => {
    const { payout } = await ordinaryUse('released');
    await prisma.ledgerEntry.createMany({
      data: [
        { transactionId: '00000000-0000-4000-8000-0000000000a1', account: 'PRACTITIONER_EARNINGS', amountKobo: 1_000, subjectId: payout.practitionerId, memo: 'Payout', payoutId: payout.id },
        { transactionId: '00000000-0000-4000-8000-0000000000a1', account: 'CASH', amountKobo: -1_000, subjectId: null, memo: 'Payout', payoutId: payout.id },
      ],
    });

    expect(await kindsOf()).toContain('payout_entries_differ');
  });

  it('shows a practitioner paid more than they earned, and cash that has gone below nothing', async () => {
    const { payout } = await ordinaryUse();
    await prisma.ledgerEntry.createMany({
      data: [
        { transactionId: '00000000-0000-4000-8000-0000000000b1', account: 'PRACTITIONER_EARNINGS', amountKobo: 5_000_000, subjectId: payout.practitionerId, memo: 'Payout', payoutId: null },
        { transactionId: '00000000-0000-4000-8000-0000000000b1', account: 'CASH', amountKobo: -5_000_000, subjectId: null, memo: 'Payout', payoutId: null },
      ],
    });

    const kinds = await kindsOf();

    expect(kinds).toEqual(['cash_negative', 'practitioner_overpaid']);
  });
});

describe('a payout released and not finished', () => {
  const longAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

  it('is reported when it was to be paid by hand and nobody has recorded the transfer for days', async () => {
    const { payout } = await ordinaryUse('released');
    await prisma.payout.update({ where: { id: payout.id }, data: { releasedAt: longAgo(5) } });

    const report = await reconcileLedger();

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ kind: 'payout_transfer_unrecorded', subject: { type: 'payout', id: payout.id } });
  });

  it('is not reported yet while finance has had only a day', async () => {
    const { payout } = await ordinaryUse('released');
    await prisma.payout.update({ where: { id: payout.id }, data: { releasedAt: longAgo(1) } });

    expect(await kindsOf()).toEqual([]);
  });

  it('is reported as unanswered when a gateway is in charge and has said nothing for an hour', async () => {
    const { payout } = await ordinaryUse('released');
    await prisma.payout.update({ where: { id: payout.id }, data: { releasedAt: new Date(Date.now() - 2 * 3_600_000) } });

    const report = await reconcileLedger({ paidByHand: false });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ kind: 'payout_unanswered', subject: { id: payout.id } });
  });
});

describe('the nightly job', () => {
  const stub = { scheduledJob: { update: vi.fn(async () => ({})) } } as never;
  const job = { id: '00000000-0000-4000-8000-0000000000dd', key: 'billing.reconciliation_sweep', interval_seconds: 86_400, run_count: 1 };
  const lastRun = () => {
    const calls = (stub as { scheduledJob: { update: { mock: { calls: unknown[][] } } } }).scheduledJob.update.mock.calls;
    return calls[calls.length - 1]![0] as { data: { lastStatus: string; lastError: string | null } };
  };

  it('is defined and has a handler, daily', () => {
    const definition = JOB_DEFINITIONS.find((candidate) => candidate.key === 'billing.reconciliation_sweep');
    expect(definition?.intervalSeconds).toBe(24 * 60 * 60);
    expect(typeof jobs['billing.reconciliation_sweep']).toBe('function');
  });

  it('succeeds on a ledger that adds up', async () => {
    await ordinaryUse();
    expect(await runJob(job, jobs, stub)).toBe('succeeded');
    expect(lastRun().data.lastStatus).toBe('SUCCEEDED');
  });

  it('fails on one that does not, saying what kind of break and how many, and logging the ids and no names', async () => {
    const { payout } = await ordinaryUse();
    await prisma.ledgerEntry.deleteMany({ where: { payoutId: payout.id } });
    const error = vi.spyOn(logger, 'error');

    expect(await runJob(job, jobs, stub)).toBe('failed');

    expect(lastRun().data.lastStatus).toBe('FAILED');
    expect(lastRun().data.lastError).toContain('payout_entries_differ');
    const logged = error.mock.calls.find((call) => (call[1] as { event?: string } | undefined)?.event === 'reconciliation_break');
    expect(logged).toBeDefined();
    const fields = JSON.stringify(logged![1]);
    expect(fields).toContain(payout.id);
    // Ids and amounts only: not a name, and not the bank's reference a person typed.
    for (const text of ['Facility Representative', 'Ibadan University Hospital', 'Finance Officer', 'FBN/TRF/0042', 'GTB/OUT/55120']) {
      expect(fields).not.toContain(text);
    }
    error.mockRestore();
  });
});

describe('over the API', () => {
  const get = () => reconciliationRoute(new Request('http://localhost/api/v1/finance/reconciliation', { method: 'GET' }));

  it('is refused without a session', async () => {
    expect((await get()).status).toBe(401);
  });

  it('is refused to somebody who cannot read invoices', async () => {
    const bystander = await createUser({ fullName: 'Bystander' });
    await issueSession({ userId: bystander.id });
    expect((await get()).status).toBe(403);
  });

  it('answers finance with what it checked and what it found, and needs no fresh password to look', async () => {
    const { payout, officer } = await ordinaryUse();
    await prisma.ledgerEntry.deleteMany({ where: { payoutId: payout.id } });
    await issueSession({ userId: officer.id });

    const response = await get();

    expect(response.status).toBe(200);
    const body = (await response.json()) as { checked: { payouts: number }; findings: { kind: string }[] };
    expect(body.checked.payouts).toBe(1);
    expect(body.findings.map((finding) => finding.kind)).toEqual(['payout_entries_differ']);
  });
});
