import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Platform-wide money, computed in the database.
 *
 * The Finance page used to list every verified facility and then request each
 * one's invoices separately — one request per facility, forever — and add the
 * results up in the browser. Both halves of that are a database's job: the
 * totals and the monthly buckets are sums, and the table is a paged query over
 * one table.
 *
 * Only invoices of VERIFIED facilities are counted, as the page always did; a
 * facility that is not verified cannot publish work, so it has none worth
 * reporting, and the filter keeps this identical to what the old page showed.
 */

export interface FinanceSummary {
  totals: { outstandingKobo: number; paidKobo: number; draftKobo: number; feesKobo: number };
  /** By the month of the work (period start, Lagos time), invoiced against paid. */
  byMonth: { month: string; invoicedKobo: number; paidKobo: number }[];
  /** Who owes what: the largest outstanding balances, biggest first. */
  byFacility: { facilityId: string; name: string; outstandingKobo: number }[];
}

const MONTHS = 24;
const TOP_DEBTORS = 10;

export async function financeSummary(): Promise<FinanceSummary> {
  const [totals, byMonth, byFacility] = await Promise.all([
    prisma.$queryRaw<{ outstanding: number; paid: number; draft: number; fees: number }[]>`
      SELECT coalesce(sum(i.gross_kobo) FILTER (WHERE i.status = 'ISSUED'), 0)::float8 AS outstanding,
             coalesce(sum(i.gross_kobo) FILTER (WHERE i.status = 'PAID'), 0)::float8 AS paid,
             coalesce(sum(i.gross_kobo) FILTER (WHERE i.status = 'DRAFT'), 0)::float8 AS draft,
             coalesce(sum(i.platform_fee_kobo) FILTER (WHERE i.status <> 'VOID'), 0)::float8 AS fees
      FROM billing.invoices i
      JOIN facilities.facilities f ON f.id = i.facility_id AND f.status = 'VERIFIED'`,
    prisma.$queryRaw<{ month: string; invoiced: number; paid: number }[]>`
      SELECT to_char(date_trunc('month', i.period_start AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM') AS month,
             coalesce(sum(i.gross_kobo) FILTER (WHERE i.status <> 'VOID'), 0)::float8 AS invoiced,
             coalesce(sum(i.gross_kobo) FILTER (WHERE i.status = 'PAID'), 0)::float8 AS paid
      FROM billing.invoices i
      JOIN facilities.facilities f ON f.id = i.facility_id AND f.status = 'VERIFIED'
      WHERE i.period_start >= now() - make_interval(months => ${MONTHS}::int)
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ facility_id: string; name: string; outstanding: number }[]>`
      SELECT f.id AS facility_id, f.name, sum(i.gross_kobo)::float8 AS outstanding
      FROM billing.invoices i
      JOIN facilities.facilities f ON f.id = i.facility_id AND f.status = 'VERIFIED'
      WHERE i.status = 'ISSUED'
      GROUP BY f.id, f.name
      HAVING sum(i.gross_kobo) > 0
      ORDER BY outstanding DESC, f.name ASC
      LIMIT ${TOP_DEBTORS}::int`,
  ]);

  const t = totals[0];
  return {
    totals: {
      outstandingKobo: Number(t?.outstanding ?? 0),
      paidKobo: Number(t?.paid ?? 0),
      draftKobo: Number(t?.draft ?? 0),
      feesKobo: Number(t?.fees ?? 0),
    },
    byMonth: byMonth.map((row) => ({
      month: row.month,
      invoicedKobo: Number(row.invoiced),
      paidKobo: Number(row.paid),
    })),
    byFacility: byFacility.map((row) => ({
      facilityId: row.facility_id,
      name: row.name,
      outstandingKobo: Number(row.outstanding),
    })),
  };
}

export interface InvoiceRowView {
  id: string;
  facilityId: string;
  facilityName: string;
  number: string;
  status: string;
  grossKobo: number;
  platformFeeKobo: number;
  periodStart: Date;
  issuedAt: Date | null;
  paidAt: Date | null;
}

/**
 * Every invoice, newest first, paged by cursor and filtered in the database.
 * No line items: the table shows the invoice, and a hospital's own page is
 * where the lines are read.
 */
export async function listPlatformInvoices(input: {
  status?: 'DRAFT' | 'ISSUED' | 'PAID';
  search?: string;
  limit: number;
  cursor?: string;
}): Promise<{ invoices: InvoiceRowView[]; nextCursor: string | null }> {
  const where: Prisma.InvoiceWhereInput = {
    facility: {
      status: 'VERIFIED',
      ...(input.search
        ? { name: { contains: input.search.trim(), mode: 'insensitive' as const } }
        : {}),
    },
    ...(input.status ? { status: input.status } : {}),
  };

  const rows = await prisma.invoice.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      facilityId: true,
      number: true,
      status: true,
      grossKobo: true,
      platformFeeKobo: true,
      periodStart: true,
      issuedAt: true,
      paidAt: true,
      facility: { select: { name: true } },
    },
  });

  const page = rows.slice(0, input.limit);
  return {
    invoices: page.map(({ facility, ...row }) => ({ ...row, facilityName: facility.name })),
    nextCursor: rows.length > input.limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}
