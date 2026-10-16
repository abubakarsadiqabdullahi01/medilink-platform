import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FINDING_TITLES,
  STRANDED_RELEASE_MINUTES,
  UNRECORDED_TRANSFER_DAYS,
  reconcile,
  summarise,
  type Snapshot,
} from './reconciliation';

/**
 * M12-07: does the money add up, from the ledger and the records that point at it.
 *
 * Every rule here is a statement the ledger is built to keep (`ledger.ts` refuses an unbalanced
 * transaction; `invoice.ts` posts a transaction per shift, a payment and a reversal; `payout.ts`
 * posts two entries when a payout settles). A reconciliation is what shows one of them stopped
 * being true: by a bug, by a write made outside the code, or by a process that stopped half-way.
 * The checks read a snapshot of sums, so they are tested here without a database.
 */

const NOW = new Date('2026-10-16T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const daysAgo = (days: number) => minutesAgo(days * 24 * 60);

/** A small, correct world: one issued invoice, one paid one, one voided one, three payouts. */
function clean(): Snapshot {
  return {
    unbalancedTransactions: [],
    ledgerSumKobo: 0,
    cashKobo: 600_000,
    facilityPayable: [{ facilityId: 'f1', kobo: 1_000_000 }],
    practitionerEarnings: [{ practitionerId: 'p1', kobo: -1_400_000 }],
    invoices: [
      // Issued: owed, nothing paid.
      { id: 'i1', number: 'INV-1', status: 'ISSUED', grossKobo: 1_000_000, paymentAmountKobo: null, liveLinesKobo: 1_000_000, liveLineCount: 2, payableKobo: 1_000_000, cashKobo: 0 },
      // Paid in full.
      { id: 'i2', number: 'INV-2', status: 'PAID', grossKobo: 800_000, paymentAmountKobo: 800_000, liveLinesKobo: 800_000, liveLineCount: 1, payableKobo: 0, cashKobo: 800_000 },
      // Voided: every posting cancelled by its reversal.
      { id: 'i3', number: 'INV-3', status: 'VOID', grossKobo: 500_000, paymentAmountKobo: null, liveLinesKobo: 0, liveLineCount: 0, payableKobo: 0, cashKobo: 0 },
    ],
    payouts: [
      { id: 'o1', status: 'SETTLED', amountKobo: 200_000, releasedAt: daysAgo(5), providerReference: 'ref', earningsKobo: 200_000, cashKobo: -200_000, entryCount: 2 },
      { id: 'o2', status: 'PREPARED', amountKobo: 100_000, releasedAt: null, providerReference: null, earningsKobo: 0, cashKobo: 0, entryCount: 0 },
      { id: 'o3', status: 'FAILED', amountKobo: 100_000, releasedAt: daysAgo(2), providerReference: null, earningsKobo: 0, cashKobo: 0, entryCount: 0 },
    ],
  };
}

const run = (snapshot: Snapshot, byHand = true) => reconcile(snapshot, { now: NOW, paidByHand: byHand });
const kinds = (snapshot: Snapshot, byHand = true) => run(snapshot, byHand).map((finding) => finding.kind);

describe('a ledger that adds up', () => {
  it('has nothing to report', () => {
    expect(run(clean())).toEqual([]);
  });

  it('has nothing to report when it is empty, which is what a new platform looks like', () => {
    expect(
      run({ unbalancedTransactions: [], ledgerSumKobo: 0, cashKobo: 0, facilityPayable: [], practitionerEarnings: [], invoices: [], payouts: [] }),
    ).toEqual([]);
  });
});

describe('the ledger itself', () => {
  it('reports a transaction that does not sum to zero, with how far out it is', () => {
    const snapshot = { ...clean(), unbalancedTransactions: [{ transactionId: 't1', sumKobo: -500 }] };
    const [finding] = run(snapshot);
    expect(finding).toMatchObject({
      kind: 'transaction_unbalanced',
      subject: { type: 'transaction', id: 't1' },
      expectedKobo: 0,
      actualKobo: -500,
    });
  });

  it('reports every entry in the ledger not summing to zero, either way, even when no single transaction shows it', () => {
    expect(kinds({ ...clean(), ledgerSumKobo: 1 })).toEqual(['ledger_not_zero']);
    expect(kinds({ ...clean(), ledgerSumKobo: -1 })).toEqual(['ledger_not_zero']);
  });

  it('reports cash that has gone below nothing: more has left than ever came in', () => {
    expect(kinds({ ...clean(), cashKobo: -1 })).toEqual(['cash_negative']);
    expect(kinds({ ...clean(), cashKobo: 0 })).toEqual([]);
  });

  it('reports a facility that has paid more than it was billed', () => {
    const [finding] = run({ ...clean(), facilityPayable: [{ facilityId: 'f9', kobo: -1 }] });
    expect(finding).toMatchObject({ kind: 'facility_overpaid', subject: { type: 'facility', id: 'f9' }, actualKobo: -1 });
    expect(kinds({ ...clean(), facilityPayable: [{ facilityId: 'f9', kobo: 0 }] })).toEqual([]);
  });

  it('reports a practitioner who has been paid more than they earned', () => {
    const [finding] = run({ ...clean(), practitionerEarnings: [{ practitionerId: 'p9', kobo: 1 }] });
    expect(finding).toMatchObject({ kind: 'practitioner_overpaid', subject: { type: 'practitioner', id: 'p9' }, actualKobo: 1 });
    expect(kinds({ ...clean(), practitionerEarnings: [{ practitionerId: 'p9', kobo: 0 }] })).toEqual([]);
  });
});

describe('an invoice', () => {
  const only = (patch: Partial<Snapshot['invoices'][number]>, id = 'i1'): Snapshot => {
    const snapshot = clean();
    snapshot.invoices = snapshot.invoices.map((invoice) => (invoice.id === id ? { ...invoice, ...patch } : invoice));
    return snapshot;
  };

  it('reports lines that do not come to what the invoice says', () => {
    const [finding] = run(only({ liveLinesKobo: 999_999 }));
    expect(finding).toMatchObject({ kind: 'invoice_lines_differ', subject: { type: 'invoice', id: 'i1', label: 'INV-1' }, expectedKobo: 1_000_000, actualKobo: 999_999 });
  });

  it('reports a draft or issued invoice whose ledger entries do not owe what it says', () => {
    expect(kinds(only({ payableKobo: 900_000 }))).toEqual(['invoice_ledger_differs']);
    expect(kinds(only({ payableKobo: 0 }))).toEqual(['invoice_ledger_differs']);
  });

  it('reports a draft or issued invoice with cash against it, which has not been paid', () => {
    expect(kinds(only({ cashKobo: 1 }))).toEqual(['invoice_ledger_differs']);
  });

  it('reports a paid invoice whose cash and what is still owed do not match what was recorded', () => {
    expect(kinds(only({ cashKobo: 799_999 }, 'i2'))).toEqual(['invoice_ledger_differs']);
    expect(kinds(only({ payableKobo: 1 }, 'i2'))).toEqual(['invoice_ledger_differs']);
    expect(kinds(only({ cashKobo: 0, payableKobo: 800_000 }, 'i2'))).toEqual(['invoice_ledger_differs']);
  });

  it('reports a paid invoice whose recorded payment is not the whole of it', () => {
    expect(kinds(only({ paymentAmountKobo: 700_000 }, 'i2'))).toContain('payment_amount_differs');
  });

  it('is not troubled by a paid invoice that predates recording the payment amount', () => {
    expect(kinds(only({ paymentAmountKobo: null }, 'i2'))).toEqual([]);
  });

  it('reports a voided invoice whose postings were not all reversed', () => {
    expect(kinds(only({ payableKobo: 500_000 }, 'i3'))).toEqual(['invoice_ledger_differs']);
    expect(kinds(only({ cashKobo: -1 }, 'i3'))).toEqual(['invoice_ledger_differs']);
  });

  it('reports a voided invoice that still has a live line, which would pin its shift', () => {
    expect(kinds(only({ liveLineCount: 1, liveLinesKobo: 100 }, 'i3'))).toEqual(['invoice_lines_differ']);
  });

  it('names the invoice by its number so somebody can find it', () => {
    const [finding] = run(only({ liveLinesKobo: 1 }, 'i2'));
    expect(finding!.subject).toMatchObject({ type: 'invoice', id: 'i2', label: 'INV-2' });
  });
});

describe('a payout', () => {
  const only = (patch: Partial<Snapshot['payouts'][number]>, id = 'o1'): Snapshot => {
    const snapshot = clean();
    snapshot.payouts = snapshot.payouts.map((payout) => (payout.id === id ? { ...payout, ...patch } : payout));
    return snapshot;
  };

  it('reports a settled payout that has no ledger entries, which is money out unrecorded', () => {
    expect(kinds(only({ earningsKobo: 0, cashKobo: 0, entryCount: 0 }))).toEqual(['payout_entries_differ']);
  });

  it('reports a settled payout with the wrong amounts or the wrong number of entries', () => {
    expect(kinds(only({ cashKobo: -199_999 }))).toEqual(['payout_entries_differ']);
    expect(kinds(only({ earningsKobo: 100_000 }))).toEqual(['payout_entries_differ']);
    expect(kinds(only({ entryCount: 4 }))).toEqual(['payout_entries_differ']);
  });

  it.each(['PREPARED', 'RELEASED', 'FAILED', 'CANCELLED'] as const)(
    'reports a %s payout that has ledger entries, because nothing has been paid',
    (status) => {
      const snapshot = only({ status, releasedAt: status === 'RELEASED' ? minutesAgo(1) : null, earningsKobo: 100_000, cashKobo: -100_000, entryCount: 2 }, 'o2');
      expect(kinds(snapshot)).toEqual(['payout_entries_differ']);
    },
  );

  describe('released and never answered, with a gateway', () => {
    const released = (minutes: number): Snapshot =>
      only({ status: 'RELEASED', releasedAt: minutesAgo(minutes), providerReference: null, earningsKobo: 0, cashKobo: 0, entryCount: 0 }, 'o2');

    it(`is reported once it has waited more than ${STRANDED_RELEASE_MINUTES} minutes`, () => {
      expect(kinds(released(STRANDED_RELEASE_MINUTES + 1), false)).toEqual(['payout_unanswered']);
    });

    it('is left alone while it is recent, because the gateway may still answer', () => {
      expect(kinds(released(STRANDED_RELEASE_MINUTES - 1), false)).toEqual([]);
    });

    it('is not reported once the gateway has given a reference, which is its answer', () => {
      const snapshot = released(STRANDED_RELEASE_MINUTES * 5);
      snapshot.payouts = snapshot.payouts.map((payout) => (payout.id === 'o2' ? { ...payout, providerReference: 'ref-1' } : payout));
      expect(kinds(snapshot, false)).toEqual([]);
    });
  });

  describe('released to be paid by hand', () => {
    const released = (days: number): Snapshot =>
      only({ status: 'RELEASED', releasedAt: daysAgo(days), providerReference: null, earningsKobo: 0, cashKobo: 0, entryCount: 0 }, 'o2');

    it('has no reference until finance records the transfer, so that is not a fault in itself', () => {
      expect(kinds(released(UNRECORDED_TRANSFER_DAYS - 0.5), true)).toEqual([]);
    });

    it(`is reported once it has waited more than ${UNRECORDED_TRANSFER_DAYS} days for the transfer to be recorded`, () => {
      const [finding] = run(released(UNRECORDED_TRANSFER_DAYS + 0.5), true);
      expect(finding).toMatchObject({ kind: 'payout_transfer_unrecorded', subject: { type: 'payout', id: 'o2' } });
    });

    it('is not mistaken for a gateway that never answered', () => {
      expect(kinds(released(30), true)).not.toContain('payout_unanswered');
    });
  });
});

describe('what is reported', () => {
  it('carries ids, amounts and a sentence, and no name, so it can be read by anybody who may see finance', () => {
    const findings = run({
      ...clean(),
      unbalancedTransactions: [{ transactionId: 't1', sumKobo: 5 }],
      cashKobo: -10,
      practitionerEarnings: [{ practitionerId: 'p9', kobo: 3 }],
    });
    expect(findings.length).toBe(3);
    for (const finding of findings) {
      expect(finding.detail.length, finding.kind).toBeGreaterThan(30);
      expect(Object.keys(finding).sort(), finding.kind).toEqual(['actualKobo', 'detail', 'expectedKobo', 'kind', 'subject']);
    }
  });

  it('is reported in a stable order, so one run reads like the one before', () => {
    const snapshot = {
      ...clean(),
      cashKobo: -1,
      unbalancedTransactions: [{ transactionId: 'b', sumKobo: 1 }, { transactionId: 'a', sumKobo: 1 }],
    };
    expect(run(snapshot)).toEqual(run({ ...snapshot, unbalancedTransactions: [...snapshot.unbalancedTransactions].reverse() }));
  });

  it('is summarised as how many of each kind, for a log line and a job failure', () => {
    const findings = run({ ...clean(), cashKobo: -1, unbalancedTransactions: [{ transactionId: 't1', sumKobo: 1 }, { transactionId: 't2', sumKobo: 1 }] });
    expect(summarise(findings)).toEqual({ transaction_unbalanced: 2, cash_negative: 1 });
    expect(summarise([])).toEqual({});
  });
});

describe('the titles the Finance page uses', () => {
  it('say each kind in words, once each', () => {
    const titles = Object.values(FINDING_TITLES);
    expect(titles.length).toBe(11);
    expect(new Set(titles).size).toBe(titles.length);
    for (const [kind, title] of Object.entries(FINDING_TITLES)) {
      expect(title.length, kind).toBeGreaterThan(15);
      expect(title, kind).not.toMatch(/_/);
    }
  });
});

describe('the page that explains the findings', () => {
  const page = readFileSync(join(__dirname, '../../../../docs/money-reconciliation.md'), 'utf8');

  it('names every kind of finding, so none can be added without saying what to do about it', () => {
    for (const kind of Object.keys(FINDING_TITLES)) expect(page, kind).toContain(`\`${kind}\``);
  });

  it('says the thresholds the code uses', () => {
    expect(page).toContain(`**${STRANDED_RELEASE_MINUTES} minutes**`);
    expect(page).toContain(`**${UNRECORDED_TRANSFER_DAYS} days**`);
    expect(page).toContain(`more than ${STRANDED_RELEASE_MINUTES} minutes`);
    expect(page).toContain(`more than ${UNRECORDED_TRANSFER_DAYS} days ago`);
  });
});
