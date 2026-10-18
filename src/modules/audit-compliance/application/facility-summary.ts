import { Prisma } from '@prisma/client';
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

/**
 * What a ward manager asks first thing: is today covered, what is still open, who is waiting on
 * whom, and has everybody arrived. These are *additions*, each gated by the permission of the page
 * it summarises at this facility, and none changes a field below. The older `published` and
 * `roster` stay as they were; `roster` in particular counts every confirmed assignment of any
 * date, which is why it cannot answer "who is due today" and `coverage` exists.
 */
/** One shift, as a list row on the dashboard. No names: it is about the shift, not the people. */
export interface ShiftRow {
  id: string;
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  filled: number;
  shiftType: string;
  urgency: string;
  profession: string;
}

export interface CoverageSummary {
  /** Published or filled shifts that start today, Lagos time. */
  todayShifts: number;
  todayNeeded: number;
  todayFilled: number;
  /** Shifts today with fewer people than they asked for. */
  todayUnfilledShifts: number;
  /** Published shifts still to start with places left. */
  openShifts: number;
  /** ...of which start within the next 24 hours. */
  openNext24h: number;
  nextOpenStartsAt: Date | null;
  /** Today's shifts, earliest first (at most eight). */
  today: ShiftRow[];
  /** The next shifts still short of people, soonest first (at most five). */
  open: ShiftRow[];
}

export interface OffersSummary {
  /** Offered, the practitioner has not answered and the offer has not lapsed. */
  awaitingResponse: number;
  oldestAwaitingResponse: Date | null;
  /** Accepted by the practitioner, waiting for this facility to confirm. */
  awaitingConfirmation: number;
  oldestAwaitingConfirmation: Date | null;
}

export interface AttendanceSummary {
  /** Confirmed, started more than 15 minutes ago, still on shift, and not checked in. */
  notArrived: number;
  notArrivedEarliestStart: Date | null;
  /** Ended with nobody checked in and not yet decided: the overnight sweep will flag these. */
  endedUnattended: number;
  /** Recorded as no-shows in the last seven days. */
  noShows7d: number;
}

export interface InvoicesSummary {
  /** Issued and not yet paid. Drafts are not shown to a facility, so they are not counted. */
  outstandingKobo: number;
  outstandingCount: number;
  oldestIssuedAt: Date | null;
  paid30dKobo: number;
}

export interface StaffSummary {
  /** People with access to this facility right now. */
  people: number;
  /** ...of whom this many are owners. One means the facility has a single point of failure. */
  owners: number;
  pendingInvitations: number;
  /** Invitations nobody answered before they ran out, in the last 14 days. */
  lapsedInvitations: number;
}

export interface FacilitySummary {
  published?: number;
  roster?: number;
  awaitingApproval?: number;
  /** When the oldest submitted timesheet was sent in. */
  awaitingOldest?: Date | null;
  coverage?: CoverageSummary;
  offers?: OffersSummary;
  attendance?: AttendanceSummary;
  invoices?: InvoicesSummary;
  staff?: StaffSummary;
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
      prisma.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM service_requests.service_requests
          WHERE facility_id = ${facilityId}::uuid AND status = 'PUBLISHED' AND deleted_at IS NULL`.then(
        (rows) => void (out.published = rows[0]?.count ?? 0),
      ),
      prisma.$queryRaw<{ week: string; needed: number; filled: number }[]>`
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
          GROUP BY 1 ORDER BY 1`.then((rows) => void (out.fulfilment = rows)),
    );
  }

  if (can('attendance.record') || can('timesheet.approve')) {
    tasks.push(
      prisma.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM matching.assignments
          WHERE facility_id = ${facilityId}::uuid AND status = 'CONFIRMED'`.then(
        (rows) => void (out.roster = rows[0]?.count ?? 0),
      ),
    );
  }

  if (can('timesheet.approve')) {
    // Only a SUBMITTED timesheet is waiting on this hospital. Counted over the
    // confirmed shifts, as the tile always was: an approved one has left them.
    tasks.push(
      prisma.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM matching.assignments a
          JOIN attendance.attendance_records ar ON ar.assignment_id = a.id
          WHERE a.facility_id = ${facilityId}::uuid AND a.status = 'CONFIRMED'
            AND ar.status = 'SUBMITTED'`.then(
        (rows) => void (out.awaitingApproval = rows[0]?.count ?? 0),
      ),
    );
  }

  if (can('invoice.read')) {
    tasks.push(
      prisma.$queryRaw<{ month: string; invoiced: number; paid: number }[]>`
          SELECT to_char(date_trunc('month', period_start AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM') AS month,
                 coalesce(sum(gross_kobo) FILTER (WHERE status <> 'VOID'), 0)::float8 AS invoiced,
                 coalesce(sum(gross_kobo) FILTER (WHERE status = 'PAID'), 0)::float8 AS paid
          FROM billing.invoices
          WHERE facility_id = ${facilityId}::uuid
            AND period_start >= now() - make_interval(months => ${MONTHS}::int)
          GROUP BY 1 ORDER BY 1`.then(
        (rows) =>
          void (out.spend = rows.map((row) => ({
            month: row.month,
            invoicedKobo: Number(row.invoiced),
            paidKobo: Number(row.paid),
          }))),
      ),
    );
  }

  if (can('service_request.read')) {
    tasks.push(coverage(facilityId).then((value) => void (out.coverage = value)));
    tasks.push(offers(facilityId).then((value) => void (out.offers = value)));
  }
  if (can('attendance.record')) {
    tasks.push(attendance(facilityId).then((value) => void (out.attendance = value)));
  }
  if (can('timesheet.approve')) {
    tasks.push(
      prisma.$queryRaw<{ oldest: Date | null }[]>`
          SELECT min(ar.submitted_at) AS oldest
          FROM matching.assignments a
          JOIN attendance.attendance_records ar ON ar.assignment_id = a.id
          WHERE a.facility_id = ${facilityId}::uuid AND a.status = 'CONFIRMED'
            AND ar.status = 'SUBMITTED'`.then(
        (rows) => void (out.awaitingOldest = rows[0]?.oldest ?? null),
      ),
    );
  }
  if (can('invoice.read')) {
    tasks.push(invoices(facilityId).then((value) => void (out.invoices = value)));
  }
  if (can('role.grant')) {
    tasks.push(staff(facilityId).then((value) => void (out.staff = value)));
  }

  await Promise.all(tasks);
  return out;
}

/**
 * Lagos midnight to midnight, worked out in SQL so a shift at 00:30 WAT is in *its* day. The
 * columns hold UTC without a zone (Prisma's convention), which is why both ends are converted back.
 */
const BOUNDS = `
  now() AT TIME ZONE 'UTC' AS now_utc,
  ((now() AT TIME ZONE 'Africa/Lagos')::date::timestamp AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'UTC' AS day_start`;

/** Each shift with how many places are taken, shared by the counts and the two lists. */
const REQUESTS = `
  SELECT r.id, r.starts_at, r.ends_at, r.headcount, r.status, r.shift_type, r.urgency,
         r.professional_category_id,
         least(coalesce(a.booked, 0), r.headcount) AS filled
  FROM service_requests.service_requests r
  LEFT JOIN (
    SELECT service_request_id, count(*)::int AS booked
    FROM matching.assignments WHERE status <> 'CANCELLED' GROUP BY 1
  ) a ON a.service_request_id = r.id`;

type ListRow = {
  id: string;
  starts_at: Date;
  ends_at: Date;
  headcount: number;
  filled: number;
  shift_type: string;
  urgency: string;
  profession: string;
};

const toShiftRow = (row: ListRow): ShiftRow => ({
  id: row.id,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  headcount: row.headcount,
  filled: row.filled,
  shiftType: row.shift_type,
  urgency: row.urgency,
  profession: row.profession,
});

async function coverage(facilityId: string): Promise<CoverageSummary> {
  const [counts, today, open] = await Promise.all([
    prisma.$queryRaw<
      {
        today_shifts: number;
        today_needed: number;
        today_filled: number;
        today_unfilled_shifts: number;
        open_shifts: number;
        open_next_24h: number;
        next_open: Date | null;
      }[]
    >(Prisma.sql`WITH b AS (SELECT ${Prisma.raw(BOUNDS)}),
     req AS (${Prisma.raw(REQUESTS)}
       WHERE r.facility_id = ${facilityId}::uuid AND r.deleted_at IS NULL AND r.status IN ('PUBLISHED', 'FILLED'))
     SELECT
       count(*) FILTER (WHERE req.starts_at >= b.day_start AND req.starts_at < b.day_start + interval '1 day')::int AS today_shifts,
       coalesce(sum(req.headcount) FILTER (WHERE req.starts_at >= b.day_start AND req.starts_at < b.day_start + interval '1 day'), 0)::int AS today_needed,
       coalesce(sum(req.filled) FILTER (WHERE req.starts_at >= b.day_start AND req.starts_at < b.day_start + interval '1 day'), 0)::int AS today_filled,
       count(*) FILTER (WHERE req.starts_at >= b.day_start AND req.starts_at < b.day_start + interval '1 day' AND req.filled < req.headcount)::int AS today_unfilled_shifts,
       count(*) FILTER (WHERE req.status = 'PUBLISHED' AND req.starts_at > b.now_utc AND req.filled < req.headcount)::int AS open_shifts,
       count(*) FILTER (WHERE req.status = 'PUBLISHED' AND req.starts_at > b.now_utc AND req.starts_at <= b.now_utc + interval '24 hours' AND req.filled < req.headcount)::int AS open_next_24h,
       min(req.starts_at) FILTER (WHERE req.status = 'PUBLISHED' AND req.starts_at > b.now_utc AND req.filled < req.headcount) AS next_open
     FROM req, b`),
    prisma.$queryRaw<ListRow[]>(Prisma.sql`WITH b AS (SELECT ${Prisma.raw(BOUNDS)}),
     req AS (${Prisma.raw(REQUESTS)}
       WHERE r.facility_id = ${facilityId}::uuid AND r.deleted_at IS NULL AND r.status IN ('PUBLISHED', 'FILLED'))
     SELECT req.id::text AS id, req.starts_at, req.ends_at, req.headcount, req.filled,
            req.shift_type::text AS shift_type, req.urgency::text AS urgency, pc.name AS profession
     FROM req
     JOIN config.professional_categories pc ON pc.id = req.professional_category_id, b
     WHERE req.starts_at >= b.day_start AND req.starts_at < b.day_start + interval '1 day'
     ORDER BY req.starts_at, req.id
     LIMIT 8`),
    prisma.$queryRaw<ListRow[]>(Prisma.sql`WITH b AS (SELECT ${Prisma.raw(BOUNDS)}),
     req AS (${Prisma.raw(REQUESTS)}
       WHERE r.facility_id = ${facilityId}::uuid AND r.deleted_at IS NULL AND r.status = 'PUBLISHED')
     SELECT req.id::text AS id, req.starts_at, req.ends_at, req.headcount, req.filled,
            req.shift_type::text AS shift_type, req.urgency::text AS urgency, pc.name AS profession
     FROM req
     JOIN config.professional_categories pc ON pc.id = req.professional_category_id, b
     WHERE req.starts_at > b.now_utc AND req.filled < req.headcount
     ORDER BY req.starts_at, req.id
     LIMIT 5`),
  ]);
  const row = counts[0];
  return {
    todayShifts: row?.today_shifts ?? 0,
    todayNeeded: row?.today_needed ?? 0,
    todayFilled: row?.today_filled ?? 0,
    todayUnfilledShifts: row?.today_unfilled_shifts ?? 0,
    openShifts: row?.open_shifts ?? 0,
    openNext24h: row?.open_next_24h ?? 0,
    nextOpenStartsAt: row?.next_open ?? null,
    today: today.map(toShiftRow),
    open: open.map(toShiftRow),
  };
}

async function offers(facilityId: string): Promise<OffersSummary> {
  const [row] = await prisma.$queryRaw<
    {
      awaiting_response: number;
      oldest_response: Date | null;
      awaiting_confirmation: number;
      oldest_confirmation: Date | null;
    }[]
  >`
    WITH now_utc AS (SELECT now() AT TIME ZONE 'UTC' AS t)
    SELECT
      count(*) FILTER (WHERE i.status = 'INVITED' AND i.expires_at > n.t)::int AS awaiting_response,
      min(i.created_at) FILTER (WHERE i.status = 'INVITED' AND i.expires_at > n.t) AS oldest_response,
      count(*) FILTER (WHERE i.status = 'ACCEPTED' AND NOT EXISTS (
        SELECT 1 FROM matching.assignments a
        WHERE a.service_request_id = i.service_request_id AND a.user_id = i.user_id AND a.status <> 'CANCELLED'
      ))::int AS awaiting_confirmation,
      min(i.responded_at) FILTER (WHERE i.status = 'ACCEPTED' AND NOT EXISTS (
        SELECT 1 FROM matching.assignments a
        WHERE a.service_request_id = i.service_request_id AND a.user_id = i.user_id AND a.status <> 'CANCELLED'
      )) AS oldest_confirmation
    FROM matching.invitations i
    JOIN service_requests.service_requests r ON r.id = i.service_request_id
    CROSS JOIN now_utc n
    WHERE r.facility_id = ${facilityId}::uuid AND r.deleted_at IS NULL
      AND r.status = 'PUBLISHED' AND r.starts_at > n.t`;
  return {
    awaitingResponse: row?.awaiting_response ?? 0,
    oldestAwaitingResponse: row?.oldest_response ?? null,
    awaitingConfirmation: row?.awaiting_confirmation ?? 0,
    oldestAwaitingConfirmation: row?.oldest_confirmation ?? null,
  };
}

/** Minutes after the start of a shift before somebody who has not checked in is called "not arrived". */
const ARRIVAL_GRACE_MINUTES = 15;

async function attendance(facilityId: string): Promise<AttendanceSummary> {
  const [row] = await prisma.$queryRaw<
    { not_arrived: number; earliest: Date | null; ended_unattended: number; no_shows: number }[]
  >`
    WITH now_utc AS (SELECT now() AT TIME ZONE 'UTC' AS t)
    SELECT
      count(*) FILTER (
        WHERE a.status = 'CONFIRMED'
          AND a.starts_at <= n.t - make_interval(mins => ${ARRIVAL_GRACE_MINUTES}::int)
          AND a.ends_at > n.t
          AND (ar.status IS NULL OR ar.status IN ('NOT_STARTED', 'CHECK_IN_PENDING'))
      )::int AS not_arrived,
      min(a.starts_at) FILTER (
        WHERE a.status = 'CONFIRMED'
          AND a.starts_at <= n.t - make_interval(mins => ${ARRIVAL_GRACE_MINUTES}::int)
          AND a.ends_at > n.t
          AND (ar.status IS NULL OR ar.status IN ('NOT_STARTED', 'CHECK_IN_PENDING'))
      ) AS earliest,
      count(*) FILTER (
        WHERE a.status = 'CONFIRMED' AND a.ends_at <= n.t
          AND (ar.status IS NULL OR ar.status IN ('NOT_STARTED', 'CHECK_IN_PENDING'))
      )::int AS ended_unattended,
      count(*) FILTER (WHERE a.status = 'NO_SHOW' AND a.starts_at > n.t - interval '7 days')::int AS no_shows
    FROM matching.assignments a
    LEFT JOIN attendance.attendance_records ar ON ar.assignment_id = a.id
    CROSS JOIN now_utc n
    WHERE a.facility_id = ${facilityId}::uuid
      AND a.starts_at > n.t - interval '30 days' AND a.starts_at <= n.t`;
  return {
    notArrived: row?.not_arrived ?? 0,
    notArrivedEarliestStart: row?.earliest ?? null,
    endedUnattended: row?.ended_unattended ?? 0,
    noShows7d: row?.no_shows ?? 0,
  };
}

async function invoices(facilityId: string): Promise<InvoicesSummary> {
  const [row] = await prisma.$queryRaw<
    { outstanding_kobo: number; outstanding_count: number; oldest: Date | null; paid_30d: number }[]
  >`
    SELECT coalesce(sum(gross_kobo) FILTER (WHERE status = 'ISSUED'), 0)::float8 AS outstanding_kobo,
           count(*) FILTER (WHERE status = 'ISSUED')::int AS outstanding_count,
           min(issued_at) FILTER (WHERE status = 'ISSUED') AS oldest,
           coalesce(sum(gross_kobo) FILTER (
             WHERE status = 'PAID' AND paid_at > (now() AT TIME ZONE 'UTC') - interval '30 days'
           ), 0)::float8 AS paid_30d
    FROM billing.invoices
    WHERE facility_id = ${facilityId}::uuid`;
  return {
    outstandingKobo: Number(row?.outstanding_kobo ?? 0),
    outstandingCount: row?.outstanding_count ?? 0,
    oldestIssuedAt: row?.oldest ?? null,
    paid30dKobo: Number(row?.paid_30d ?? 0),
  };
}

async function staff(facilityId: string): Promise<StaffSummary> {
  const [people, invitations] = await Promise.all([
    prisma.$queryRaw<{ people: number; owners: number }[]>`
      SELECT count(DISTINCT ur.user_id)::int AS people,
             count(DISTINCT ur.user_id) FILTER (WHERE r.key = 'facility_owner')::int AS owners
      FROM identity.user_roles ur
      JOIN identity.roles r ON r.id = ur.role_id
      WHERE ur.scope_type = 'FACILITY' AND ur.scope_id = ${facilityId}::uuid AND ur.revoked_at IS NULL`,
    prisma.$queryRaw<{ pending: number; lapsed: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'PENDING' AND expires_at > now() AT TIME ZONE 'UTC')::int AS pending,
             count(*) FILTER (
               WHERE (status = 'EXPIRED' OR (status = 'PENDING' AND expires_at <= now() AT TIME ZONE 'UTC'))
                 AND expires_at > (now() AT TIME ZONE 'UTC') - interval '14 days'
             )::int AS lapsed
      FROM identity.staff_invitations
      WHERE facility_id = ${facilityId}::uuid`,
  ]);
  return {
    people: people[0]?.people ?? 0,
    owners: people[0]?.owners ?? 0,
    pendingInvitations: invitations[0]?.pending ?? 0,
    lapsedInvitations: invitations[0]?.lapsed ?? 0,
  };
}
