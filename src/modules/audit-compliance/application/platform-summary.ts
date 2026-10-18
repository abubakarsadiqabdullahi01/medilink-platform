import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { systemStatus } from './system-status';

/**
 * What the platform dashboard shows, computed in the database.
 *
 * The dashboard used to assemble this in the browser: each tile downloaded a
 * whole queue (up to 100 rows) to take its length, and the growth chart paged
 * through the audit trail 200 rows at a time — up to twenty round trips and
 * four thousand rows — to count them by month. That was tolerable on a pilot's
 * first week and is a linear cost on a table that only grows. Counting is what
 * a database is for, so this asks it once and returns a few dozen numbers.
 *
 * **This is a read-only reporting query across modules' tables, and that is a
 * deliberate exception to "a module never reads another module's tables".** The
 * alternative was a count function in each of six modules, composed by a
 * route — six places that can drift from the list they count. Each statement
 * below states the same filter its queue applies, beside the queue it
 * summarises, so a tile and the page it links to cannot quietly disagree.
 * It reads counts and dates only: no row, name or free text leaves here except
 * the single most serious open incident's summary.
 */

export type QueueKey =
  | 'credentials'
  | 'facilities'
  | 'incidents'
  | 'disputes'
  | 'unhonoured'
  | 'suggestions';

export interface QueueSummary {
  count: number;
  /** When the longest-waiting item arrived; null when the queue is empty. */
  oldest: Date | null;
}

/**
 * What else an officer should not have to open another page to learn. Each block is present only
 * for a caller who holds the permission the page it summarises requires, so none of them is a
 * second door onto anything. They are additions: no field above or below changed shape.
 */
export interface PrivacySummary {
  /** Requests received or being worked: the queue at /admin/data-requests. */
  open: number;
  /** Past the date the law gives for answering. */
  overdue: number;
  oldest: Date | null;
  /** The nearest deadline of any open request, overdue ones included. */
  nextDue: Date | null;
  /** Erasures ask for the password again before they are carried out. */
  erasures: number;
}

export interface HealthSummary {
  status: 'ok' | 'degraded';
  /** How many things the System page lists as wrong. */
  problems: number;
  deadLetter: number;
  /** Texts a gateway took and then reported it could not deliver, in the last day. */
  failedTexts24h: number;
}

export interface MoneySummary {
  /** The nightly check that the books add up. A failed run is how a difference is recorded. */
  reconciliation: { lastRunAt: Date | null; lastStatus: 'SUCCEEDED' | 'FAILED' | null; lastError: string | null };
  /**
   * The three below are the money acts, so they need `payout.manage` and are absent without it:
   * "none waiting" and "not yours to see" must not look alike.
   */
  /** Invoices raised and not yet issued. */
  draftInvoices?: QueueSummary;
  /** Payouts prepared and waiting for somebody else to release them. */
  payoutsPrepared?: QueueSummary;
  /** Payouts released, waiting for the bank transfer to be recorded. */
  payoutsReleased?: QueueSummary;
}

export interface PlatformSummary {
  queues: Partial<Record<QueueKey, QueueSummary>>;
  privacy?: PrivacySummary;
  health?: HealthSummary;
  money?: MoneySummary;
  incidentSeverity: { severity: string; count: number }[];
  worstIncident: { severity: string; category: string; summary: string; reportedAt: Date } | null;
  growth: { month: string; facilities: number; practitioners: number; usage: number }[];
  recent: { id: string; action: string; createdAt: Date }[];
}

/** The permission that lets somebody see each queue, as the queue itself requires. */
export const QUEUE_PERMISSION: Record<QueueKey, string> = {
  credentials: 'credential.review',
  facilities: 'facility.verify',
  incidents: 'incident.manage',
  disputes: 'dispute.manage',
  unhonoured: 'sanction.apply',
  suggestions: 'suggestion.triage',
};

/**
 * Each queue, with the filter its own list applies.
 *   credentials  — status PENDING, not soft-deleted        (listSubmissions)
 *   facilities   — status PENDING, not soft-deleted        (listFacilities)
 *   incidents    — anything not CLOSED                     (listIncidentQueue "OPEN")
 *   disputes     — OPEN or UNDER_REVIEW                    (listDisputes, LIVE)
 *   unhonoured   — AWAITING_DECISION                       (listUnhonoured default)
 *   suggestions  — NEW                                     (listSuggestions)
 */
const QUEUES: Record<QueueKey, Prisma.Sql> = {
  credentials: Prisma.sql`SELECT count(*)::int AS count, min(created_at) AS oldest
    FROM credentials.credential_submissions WHERE status = 'PENDING' AND deleted_at IS NULL`,
  facilities: Prisma.sql`SELECT count(*)::int AS count, min(created_at) AS oldest
    FROM facilities.facilities WHERE status = 'PENDING' AND deleted_at IS NULL`,
  incidents: Prisma.sql`SELECT count(*)::int AS count, min(reported_at) AS oldest
    FROM clinical_incidents.clinical_incidents WHERE status <> 'CLOSED'`,
  disputes: Prisma.sql`SELECT count(*)::int AS count, min(created_at) AS oldest
    FROM disputes.disputes WHERE status IN ('OPEN', 'UNDER_REVIEW')`,
  unhonoured: Prisma.sql`SELECT count(*)::int AS count, min(detected_at) AS oldest
    FROM cancellations_sanctions.unhonoured_assignments WHERE status = 'AWAITING_DECISION'`,
  suggestions: Prisma.sql`SELECT count(*)::int AS count, min(created_at) AS oldest
    FROM suggestions.suggestions WHERE status = 'NEW'`,
};

/** Months of history the growth chart shows. Bounded so the audit scan is. */
const GROWTH_MONTHS = 24;

/**
 * Month of a stored timestamp, in Lagos time. Prisma stores UTC in
 * `timestamp without time zone`, so it is declared UTC first and then moved —
 * the other way round shifts a midnight registration into the wrong month.
 */
const monthOf = (column: string) =>
  Prisma.raw(
    `to_char(date_trunc('month', ${column} AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM')`,
  );

type MonthRow = { month: string; count: number };

export async function platformSummary(permissions: ReadonlySet<string>): Promise<PlatformSummary> {
  const can = (permission: string) => permissions.has(permission);
  const visible = (Object.keys(QUEUES) as QueueKey[]).filter((key) => can(QUEUE_PERMISSION[key]));

  const [queueRows, severityRows, worstRows, facilityRows, practitionerRows, usageRows, recent] =
    await Promise.all([
      Promise.all(
        visible.map((key) =>
          prisma.$queryRaw<{ count: number; oldest: Date | null }[]>(QUEUES[key]),
        ),
      ),
      can('incident.manage')
        ? prisma.$queryRaw<{ severity: string; count: number }[]>`
            SELECT severity::text AS severity, count(*)::int AS count
            FROM clinical_incidents.clinical_incidents WHERE status <> 'CLOSED'
            GROUP BY severity`
        : Promise.resolve([]),
      can('incident.manage')
        ? prisma.$queryRaw<
            { severity: string; category: string; summary: string; reported_at: Date }[]
          >`
            SELECT severity::text AS severity, category::text AS category, summary, reported_at
            FROM clinical_incidents.clinical_incidents WHERE status <> 'CLOSED'
            ORDER BY CASE severity::text
              WHEN 'DEATH' THEN 0 WHEN 'SEVERE' THEN 1 WHEN 'MODERATE' THEN 2
              WHEN 'MINOR' THEN 3 ELSE 4 END, reported_at ASC
            LIMIT 1`
        : Promise.resolve([]),
      can('facility.read')
        ? prisma.$queryRaw<MonthRow[]>`
            SELECT ${monthOf('created_at')} AS month, count(*)::int AS count
            FROM facilities.facilities
            WHERE deleted_at IS NULL
              AND created_at >= now() - make_interval(months => ${GROWTH_MONTHS}::int)
            GROUP BY 1`
        : Promise.resolve([]),
      can('practitioner.profile.read')
        ? prisma.$queryRaw<MonthRow[]>`
            SELECT ${monthOf('u.created_at')} AS month, count(DISTINCT u.id)::int AS count
            FROM identity.users u
            JOIN identity.user_roles ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
              AND ur.scope_type = 'SELF'
            JOIN identity.roles r ON r.id = ur.role_id AND r.key = 'practitioner'
            WHERE u.deleted_at IS NULL
              AND u.created_at >= now() - make_interval(months => ${GROWTH_MONTHS}::int)
            GROUP BY 1`
        : Promise.resolve([]),
      can('audit.read')
        ? prisma.$queryRaw<MonthRow[]>`
            SELECT ${monthOf('created_at')} AS month, count(*)::int AS count
            FROM audit.audit_log
            WHERE created_at >= now() - make_interval(months => ${GROWTH_MONTHS}::int)
            GROUP BY 1`
        : Promise.resolve([]),
      can('audit.read')
        ? prisma.$queryRaw<{ id: string; action: string; created_at: Date }[]>`
            SELECT id, action, created_at FROM audit.audit_log
            ORDER BY created_at DESC, id DESC LIMIT 8`
        : Promise.resolve([]),
    ]);

  const [privacy, health, money] = await Promise.all([
    can('audit.read') ? privacySummary() : undefined,
    can('audit.read') ? healthSummary() : undefined,
    can('invoice.read') ? moneySummary(can('payout.manage')) : undefined,
  ]);

  const queues: PlatformSummary['queues'] = {};
  visible.forEach((key, index) => {
    const row = queueRows[index]?.[0];
    queues[key] = { count: row?.count ?? 0, oldest: row?.oldest ?? null };
  });

  // One bucket per month, unioned across the three series so a month only one
  // of them has data for still shows a real zero rather than a gap.
  const months = new Map<string, { facilities: number; practitioners: number; usage: number }>();
  const bump = (rows: MonthRow[], field: 'facilities' | 'practitioners' | 'usage') => {
    for (const row of rows) {
      const bucket = months.get(row.month) ?? { facilities: 0, practitioners: 0, usage: 0 };
      bucket[field] += row.count;
      months.set(row.month, bucket);
    }
  };
  bump(facilityRows, 'facilities');
  bump(practitionerRows, 'practitioners');
  bump(usageRows, 'usage');

  const worst = worstRows[0];
  return {
    queues,
    ...(privacy ? { privacy } : {}),
    ...(health ? { health } : {}),
    ...(money ? { money } : {}),
    incidentSeverity: severityRows,
    worstIncident: worst
      ? {
          severity: worst.severity,
          category: worst.category,
          summary: worst.summary,
          reportedAt: worst.reported_at,
        }
      : null,
    growth: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, value]) => ({ month, ...value })),
    recent: recent.map((row) => ({ id: row.id, action: row.action, createdAt: row.created_at })),
  };
}


/** The data-request queue's own definition of open: received, or somebody has taken it up. */
async function privacySummary(): Promise<PrivacySummary> {
  const [row] = await prisma.$queryRaw<
    { open: number; overdue: number; oldest: Date | null; next_due: Date | null; erasures: number }[]
  >`
    SELECT count(*)::int AS open,
           count(*) FILTER (WHERE due_by < now())::int AS overdue,
           min(received_at) AS oldest,
           min(due_by) AS next_due,
           count(*) FILTER (WHERE kind = 'ERASURE')::int AS erasures
    FROM consent.data_subject_requests
    WHERE status IN ('RECEIVED', 'IN_PROGRESS')`;
  return {
    open: row?.open ?? 0,
    overdue: row?.overdue ?? 0,
    oldest: row?.oldest ?? null,
    nextDue: row?.next_due ?? null,
    erasures: row?.erasures ?? 0,
  };
}

/** Counts from the System page's own reading, not a second opinion on what is wrong. */
async function healthSummary(): Promise<HealthSummary> {
  const status = await systemStatus();
  return {
    status: status.status,
    problems: status.problems.length,
    deadLetter: status.outbox.deadLetter,
    failedTexts24h: status.messages.failedAfterAccepted24h,
  };
}

async function moneySummary(canManage: boolean): Promise<MoneySummary> {
  const [job, drafts, prepared, released] = await Promise.all([
    prisma.scheduledJob.findUnique({
      where: { key: 'billing.reconciliation_sweep' },
      select: { lastRunAt: true, lastStatus: true, lastError: true },
    }),
    canManage
      ? prisma.$queryRaw<{ count: number; oldest: Date | null }[]>`
          SELECT count(*)::int AS count, min(created_at) AS oldest
          FROM billing.invoices WHERE status = 'DRAFT'`
      : undefined,
    canManage
      ? prisma.$queryRaw<{ count: number; oldest: Date | null }[]>`
          SELECT count(*)::int AS count, min(created_at) AS oldest
          FROM billing.payouts WHERE status = 'PREPARED'`
      : undefined,
    canManage
      ? prisma.$queryRaw<{ count: number; oldest: Date | null }[]>`
          SELECT count(*)::int AS count, min(released_at) AS oldest
          FROM billing.payouts WHERE status = 'RELEASED'`
      : undefined,
  ]);
  const queue = (rows: { count: number; oldest: Date | null }[] | undefined): QueueSummary | undefined =>
    rows ? { count: rows[0]?.count ?? 0, oldest: rows[0]?.oldest ?? null } : undefined;
  const draftInvoices = queue(drafts);
  const payoutsPrepared = queue(prepared);
  const payoutsReleased = queue(released);
  return {
    reconciliation: {
      lastRunAt: job?.lastRunAt ?? null,
      lastStatus: job?.lastStatus ?? null,
      // Enough to say what, never the whole message: a handler's error can run to a stack trace.
      lastError: job?.lastError ? job.lastError.slice(0, 200) : null,
    },
    ...(draftInvoices ? { draftInvoices } : {}),
    ...(payoutsPrepared ? { payoutsPrepared } : {}),
    ...(payoutsReleased ? { payoutsReleased } : {}),
  };
}
