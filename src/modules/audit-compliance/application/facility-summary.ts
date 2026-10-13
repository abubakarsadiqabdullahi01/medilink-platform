import { prisma } from '@/lib/db';

/**
 * What a hospital's dashboard shows, counted in the database.
 *
 * Opening the console used to cost one request per confirmed shift: the
 * "timesheets to approve" tile read each shift's timesheet to see which were
 * submitted, and the two charts downloaded the facility's whole shift history
 * and every invoice to add them up in the browser. A hospital with a hundred
 * shifts on its roster made a hundred and twenty requests to draw four
 * numbers and two charts. This returns exactly those, in one.
 *
 * A read-only reporting query across modules' tables — the same deliberate
 * exception, for the same reason, as platform-summary.ts.
 */

export interface FacilitySummary {
  published?: number;
  roster?: number;
  awaitingApproval?: number;
  /** Per week (Monday), in headcount: people needed against people booked. */
  fulfilment?: { week: string; needed: number; filled: number }[];
  /** Per month of the work, in kobo. */
  spend?: { month: string; invoicedKobo: number; paidKobo: number }[];
}

const WEEKS = 26;
const MONTHS = 24;

/** `permissions` is what the caller holds at (or above) this facility. */
export async function facilitySummary(
  facilityId: string,
  permissions: ReadonlySet<string>,
): Promise<FacilitySummary> {
  const can = (permission: string) => permissions.has(permission);
  const out: FacilitySummary = {};

  const tasks: Promise<void>[] = [];

  if (can('service_request.read')) {
    tasks.push(
      prisma
        .$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM service_requests.service_requests
          WHERE facility_id = ${facilityId}::uuid AND status = 'PUBLISHED' AND deleted_at IS NULL`
        .then((rows) => void (out.published = rows[0]?.count ?? 0)),
      prisma
        .$queryRaw<{ week: string; needed: number; filled: number }[]>`
          SELECT to_char(date_trunc('week', r.starts_at), 'YYYY-MM-DD') AS week,
                 sum(r.headcount)::int AS needed,
                 sum(least(coalesce(a.booked, 0), r.headcount))::int AS filled
          FROM service_requests.service_requests r
          LEFT JOIN (
            SELECT service_request_id, count(*)::int AS booked
            FROM matching.assignments WHERE status <> 'CANCELLED' GROUP BY 1
          ) a ON a.service_request_id = r.id
          WHERE r.facility_id = ${facilityId}::uuid AND r.status <> 'DRAFT' AND r.deleted_at IS NULL
            AND r.starts_at >= now() - make_interval(weeks => ${WEEKS}::int)
          GROUP BY 1 ORDER BY 1`
        .then((rows) => void (out.fulfilment = rows)),
    );
  }

  if (can('attendance.record') || can('timesheet.approve')) {
    tasks.push(
      prisma
        .$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM matching.assignments
          WHERE facility_id = ${facilityId}::uuid AND status = 'CONFIRMED'`
        .then((rows) => void (out.roster = rows[0]?.count ?? 0)),
    );
  }

  if (can('timesheet.approve')) {
    // Only a SUBMITTED timesheet is waiting on this hospital. Counted over the
    // confirmed shifts, as the tile always was: an approved one has left them.
    tasks.push(
      prisma
        .$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM matching.assignments a
          JOIN attendance.attendance_records ar ON ar.assignment_id = a.id
          WHERE a.facility_id = ${facilityId}::uuid AND a.status = 'CONFIRMED'
            AND ar.status = 'SUBMITTED'`
        .then((rows) => void (out.awaitingApproval = rows[0]?.count ?? 0)),
    );
  }

  if (can('invoice.read')) {
    tasks.push(
      prisma
        .$queryRaw<{ month: string; invoiced: number; paid: number }[]>`
          SELECT to_char(date_trunc('month', period_start AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM') AS month,
                 coalesce(sum(gross_kobo) FILTER (WHERE status <> 'VOID'), 0)::float8 AS invoiced,
                 coalesce(sum(gross_kobo) FILTER (WHERE status = 'PAID'), 0)::float8 AS paid
          FROM billing.invoices
          WHERE facility_id = ${facilityId}::uuid
            AND period_start >= now() - make_interval(months => ${MONTHS}::int)
          GROUP BY 1 ORDER BY 1`
        .then(
          (rows) =>
            void (out.spend = rows.map((row) => ({
              month: row.month,
              invoicedKobo: Number(row.invoiced),
              paidKobo: Number(row.paid),
            }))),
        ),
    );
  }

  await Promise.all(tasks);
  return out;
}
