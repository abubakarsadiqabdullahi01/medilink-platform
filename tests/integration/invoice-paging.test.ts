import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { listInvoices } from '@/modules/billing-settlement/application/invoice';
import { createFacility } from '@/modules/facilities/application/facility';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { createFacilityType, createState, createUser, ensureRole } from './support/fixtures';

/**
 * A facility's invoice list is paged, and its totals are not the page's.
 *
 * The list used to return every invoice a facility had ever been issued, lines
 * included. The page is now bounded, which makes one thing easy to get wrong:
 * the "outstanding" figure a finance officer reads as a debt must come from all
 * of the facility's invoices, not from whichever page happens to be on screen.
 */

let sequence = 0;

async function facilityWithInvoices(count: number) {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);
  const state = await createState();
  const facilityType = await createFacilityType();
  const representative = await createUser();
  const ops = await createUser();
  sequence += 1;
  const facility = await createFacility({
    name: `Paged Clinic ${sequence}`,
    facilityTypeId: facilityType.id,
    cacNumber: `RC${800_000 + sequence}`,
    stateId: state.id,
    addressLine: '1 Garden Close, Abuja',
    contactPhone: '+2348031234567',
    representativeUserId: representative.id,
    actorId: ops.id,
  });

  // One a month, the newest last: statuses cycle ISSUED, PAID, DRAFT.
  const statuses = ['ISSUED', 'PAID', 'DRAFT'] as const;
  for (let i = 0; i < count; i += 1) {
    await prisma.invoice.create({
      data: {
        facilityId: facility.id,
        number: `PAGE-${sequence}-${String(i).padStart(3, '0')}`,
        periodStart: new Date(Date.UTC(2025, i, 1)),
        periodEnd: new Date(Date.UTC(2025, i + 1, 1)),
        grossKobo: 100_000 * (i + 1),
        status: statuses[i % 3]!,
        createdBy: ops.id,
      },
    });
  }
  return facility;
}

describe('a facility’s invoice list', () => {
  it('is bounded, newest period first, and walks to the end without repeats', async () => {
    const facility = await facilityWithInvoices(7);

    const first = await listInvoices(facility.id, { limit: 3 });
    expect(first.invoices).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    expect(first.invoices[0]!.number).toMatch(/-006$/);

    const second = await listInvoices(facility.id, { limit: 3, cursor: first.nextCursor! });
    const third = await listInvoices(facility.id, { limit: 3, cursor: second.nextCursor! });
    expect(third.invoices).toHaveLength(1);
    expect(third.nextCursor).toBeNull();

    const numbers = [first, second, third].flatMap((page) => page.invoices.map((row) => row.number));
    expect(new Set(numbers).size).toBe(7);
    expect(numbers).toEqual([...numbers].sort().reverse());
  });

  it('reports what is owed and paid across every invoice, whichever page it is asked for', async () => {
    const facility = await facilityWithInvoices(7);
    // i: 0 ISSUED(100k) 1 PAID(200k) 2 DRAFT 3 ISSUED(400k) 4 PAID(500k) 5 DRAFT 6 ISSUED(700k)
    const expected = { outstandingKobo: 1_200_000, outstandingCount: 3, paidKobo: 700_000 };

    const page1 = await listInvoices(facility.id, { limit: 2 });
    const page3 = await listInvoices(facility.id, { limit: 2, cursor: (await listInvoices(facility.id, { limit: 4 })).invoices[3]!.id });

    expect(page1.totals).toEqual(expected);
    expect(page3.totals).toEqual(expected);
  });

  it('can leave drafts out of the list while the totals still count every invoice', async () => {
    const facility = await facilityWithInvoices(6);

    const billed = await listInvoices(facility.id, { limit: 50, billedOnly: true });
    const all = await listInvoices(facility.id, { limit: 50 });

    expect(all.invoices).toHaveLength(6);
    expect(billed.invoices).toHaveLength(4);
    expect(billed.invoices.every((row) => row.status !== 'DRAFT')).toBe(true);
    expect(billed.totals).toEqual(all.totals);
  });

  it('is empty, with zero totals, for a facility with no invoices', async () => {
    const facility = await facilityWithInvoices(0);
    expect(await listInvoices(facility.id)).toEqual({
      invoices: [],
      nextCursor: null,
      totals: { outstandingKobo: 0, outstandingCount: 0, paidKobo: 0 },
    });
  });
});
