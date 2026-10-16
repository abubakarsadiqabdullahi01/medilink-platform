/**
 * Production-sized data, to find out what is slow before a hospital does.
 *
 * Targets, each a floor rather than an estimate:
 *
 *   100 facilities          (all VERIFIED)
 *   1,000 practitioners
 *   4,000 shifts, 12,000 assignments
 *   10,000 invoices, one line each
 *   100,000 audit entries
 *
 * Written as set-based SQL (`generate_series`) rather than through the
 * application functions: those are what the correctness tests exercise, and
 * running them 100,000 times would take an hour and prove nothing new. The rows
 * satisfy every constraint, so reads over them behave as they would over real
 * ones; they are not a faithful history, and nothing here should be mistaken
 * for a demo (use seed-demo.ts for that).
 *
 * Runs only against a database whose name ends in `_perf`, and empties the
 * tables it fills first, so it can be re-run:
 *
 *   docker compose exec db psql -U medilink -d postgres -c "CREATE DATABASE medilink_perf"
 *   docker compose exec -e DATABASE_URL=postgresql://…/medilink_perf web pnpm prisma migrate deploy
 *   docker compose exec -e DATABASE_URL=postgresql://…/medilink_perf web pnpm db:seed
 *   docker compose exec -e DATABASE_URL=postgresql://…/medilink_perf web pnpm tsx scripts/seed-performance.ts
 *
 * Sign in as +2348031200001 (super administrator) or +2348031200002 (owner of
 * the first facility) with the demo password. scripts/load-test.ts then drives
 * the API against it.
 */
import { prisma } from '../src/lib/db';
import { assertLocal, DEMO_PASSWORD, demoPasswordHash, syncRoles } from './support/demo';

export const VOLUME = {
  facilities: 100,
  practitioners: 1_000,
  shifts: 4_000,
  assignmentsPerShift: 3,
  invoices: 10_000,
  auditEntries: 100_000,
} as const;

export const ADMIN_PHONE = '+2348031200001';
export const OWNER_PHONE = '+2348031200002';
/** The first of the thousand practitioners, given a password so the browser budget can sign in as one. */
export const PRACTITIONER_PHONE = '+2348030000001';

async function run(label: string, sql: string, ...params: unknown[]) {
  const started = Date.now();
  const rows = await prisma.$executeRawUnsafe(sql, ...params);
  console.log(`  ${label.padEnd(28)} ${String(rows).padStart(7)} rows  ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function main() {
  assertLocal('seed-performance.ts');
  const [row] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  const name = row?.name ?? '';
  if (!name.endsWith('_perf')) {
    throw new Error(`Refusing to run against "${name}": the database name must end in _perf.`);
  }

  console.log(`Seeding ${name}`);
  await syncRoles(prisma);
  await prisma.$executeRawUnsafe(
    `TRUNCATE billing.invoice_lines, billing.invoices, matching.assignments,
       service_requests.service_requests, audit.audit_log, facilities.facilities,
       identity.user_roles, identity.sessions, identity.users, practitioners.practitioner_profiles CASCADE`,
  );

  const hash = await demoPasswordHash();

  // Two people who can sign in; everyone else is a name on a row.
  await run(
    'sign-in accounts',
    `INSERT INTO identity.users (id, phone, email, password_hash, full_name, status, phone_verified_at, created_at, updated_at)
     VALUES
       (md5('perf-admin')::uuid, $1, 'admin@perf.medilink.test', $3, 'Perf Super Admin', 'ACTIVE', now(), now(), now()),
       (md5('perf-owner')::uuid, $2, 'owner@perf.medilink.test', $3, 'Perf Facility Owner', 'ACTIVE', now(), now(), now())`,
    ADMIN_PHONE,
    OWNER_PHONE,
    hash,
  );

  await run(
    'practitioners',
    `INSERT INTO identity.users (id, phone, full_name, status, phone_verified_at, created_at, updated_at)
     SELECT md5('perf-user-' || n)::uuid,
            '+234803' || lpad(n::text, 7, '0'),
            'Practitioner ' || lpad(n::text, 4, '0'),
            'ACTIVE', now(),
            now() - make_interval(days => (n % 540)::int),
            now()
       FROM generate_series(1, $1::int) AS n`,
    VOLUME.practitioners,
  );

  await run(
    'a practitioner who can sign in',
    `UPDATE identity.users SET password_hash = $1 WHERE id = md5('perf-user-1')::uuid`,
    hash,
  );

  await run(
    'a profile for that practitioner',
    `INSERT INTO practitioners.practitioner_profiles
       (id, user_id, professional_category_id, years_of_experience, submitted_for_review_at, created_at, updated_at)
     SELECT gen_random_uuid(), md5('perf-user-1')::uuid, (SELECT id FROM config.professional_categories ORDER BY id LIMIT 1),
            6, now() - interval '30 days', now() - interval '60 days', now()`,
  );

  await run(
    'role grants',
    `INSERT INTO identity.user_roles (id, user_id, role_id, scope_type, scope_id, created_at)
     SELECT gen_random_uuid(), md5('perf-admin')::uuid, r.id, 'PLATFORM'::identity."ScopeType", NULL, now()
       FROM identity.roles r WHERE r.key = 'super_administrator'
     UNION ALL
     SELECT gen_random_uuid(), md5('perf-owner')::uuid, r.id, 'FACILITY'::identity."ScopeType", md5('perf-facility-1')::uuid, now()
       FROM identity.roles r WHERE r.key = 'facility_owner'
     UNION ALL
     SELECT gen_random_uuid(), md5('perf-user-1')::uuid, r.id, 'SELF'::identity."ScopeType", md5('perf-user-1')::uuid, now()
       FROM identity.roles r WHERE r.key = 'practitioner'`,
  );

  await run(
    'facilities',
    `INSERT INTO facilities.facilities
       (id, name, facility_type_id, cac_number, state_id, address_line, contact_phone,
        representative_user_id, status, verified_at, created_at, updated_at)
     SELECT md5('perf-facility-' || n)::uuid,
            'Perf Hospital ' || lpad(n::text, 3, '0'),
            (SELECT array_agg(id ORDER BY id) FROM config.facility_types)[1 + n % (SELECT count(*) FROM config.facility_types)::int],
            'RC' || (900000 + n),
            (SELECT array_agg(id ORDER BY id) FROM config.states)[1 + n % (SELECT count(*) FROM config.states)::int],
            n || ' Perf Road',
            '+234803' || lpad((5000000 + n)::text, 7, '0'),
            md5('perf-owner')::uuid,
            'VERIFIED', now() - interval '400 days',
            now() - make_interval(days => (500 - n)),
            now()
       FROM generate_series(1, $1::int) AS n`,
    VOLUME.facilities,
  );

  // Shifts from eighteen months back to one month ahead. Facility 1 is the
  // flagship and carries a quarter of them, as a large hospital would.
  await run(
    'shifts',
    `INSERT INTO service_requests.service_requests
       (id, facility_id, professional_category_id, shift_type, starts_at, ends_at, headcount,
        hourly_rate_kobo, cancellation_terms, status, created_by, published_at, created_at, updated_at)
     SELECT md5('perf-sr-' || n)::uuid,
            md5('perf-facility-' || CASE WHEN n % 4 = 0 THEN 1 ELSE 1 + (n % $1::int) END)::uuid,
            (SELECT array_agg(id ORDER BY id) FROM config.professional_categories)[1 + n % (SELECT count(*) FROM config.professional_categories)::int],
            (CASE WHEN n % 3 = 0 THEN 'NIGHT' ELSE 'DAY' END)::service_requests."ShiftType",
            s.starts, s.starts + interval '12 hours', $3::int,
            250000 + (n % 20) * 10000,
            'Cancel at least 24 hours ahead.',
            (CASE WHEN s.starts > now() AND n % 5 = 0 THEN 'PUBLISHED'
                  WHEN n % 23 = 0 THEN 'CANCELLED'
                  ELSE 'FILLED' END)::service_requests."ServiceRequestStatus",
            md5('perf-owner')::uuid, s.starts - interval '10 days',
            s.starts - interval '12 days', now()
       FROM generate_series(1, $2::int) AS n
       CROSS JOIN LATERAL (SELECT date_trunc('hour', now() - interval '540 days' + (n::numeric / $2::numeric) * interval '570 days') AS starts) s`,
    VOLUME.facilities,
    VOLUME.shifts,
    VOLUME.assignmentsPerShift,
  );

  await run(
    'assignments',
    `INSERT INTO matching.assignments
       (id, service_request_id, user_id, facility_id, starts_at, ends_at, status, confirmed_by, created_at, updated_at)
     SELECT md5('perf-asg-' || sr.n || '-' || slot)::uuid,
            sr.id,
            md5('perf-user-' || (1 + ((sr.n * 13 + slot * 331) % $2::int)))::uuid,
            sr.facility_id, sr.starts_at, sr.ends_at,
            (CASE WHEN sr.starts_at > now() THEN 'CONFIRMED'
                  WHEN (sr.n + slot) % 20 = 0 THEN 'CANCELLED'
                  WHEN (sr.n + slot) % 20 = 1 THEN 'NO_SHOW'
                  ELSE 'COMPLETED' END)::matching."AssignmentStatus",
            md5('perf-owner')::uuid, sr.starts_at - interval '8 days', now()
       FROM (
         SELECT row_number() OVER (ORDER BY starts_at, id)::int AS n, id, facility_id, starts_at, ends_at
           FROM service_requests.service_requests
       ) sr
       CROSS JOIN generate_series(0, $1::int - 1) AS slot`,
    VOLUME.assignmentsPerShift,
    VOLUME.practitioners,
  );

  // One invoice per assignment for the first ten thousand, so each invoice line
  // has the assignment it must have and the facility on both agree.
  await run(
    'invoices',
    `INSERT INTO billing.invoices
       (id, facility_id, number, period_start, period_end, gross_kobo, platform_fee_kobo, status,
        issued_at, paid_at, created_by, created_at, updated_at)
     SELECT md5('perf-inv-' || a.n)::uuid, a.facility_id, 'PERF-' || lpad(a.n::text, 6, '0'),
            date_trunc('month', a.starts_at), date_trunc('month', a.starts_at) + interval '1 month',
            a.gross, a.gross / 20,
            (CASE WHEN a.n % 10 < 5 THEN 'PAID' WHEN a.n % 10 < 8 THEN 'ISSUED' WHEN a.n % 10 < 9 THEN 'DRAFT' ELSE 'VOID' END)::billing."InvoiceStatus",
            CASE WHEN a.n % 10 < 8 THEN a.starts_at + interval '5 days' END,
            CASE WHEN a.n % 10 < 5 THEN a.starts_at + interval '20 days' END,
            md5('perf-owner')::uuid, a.starts_at + interval '3 days', now()
       FROM (
         SELECT row_number() OVER (ORDER BY starts_at, id)::int AS n, id, facility_id, starts_at,
                (300000 + (hashtext(id::text) & 1023) * 1500) AS gross
           FROM matching.assignments
       ) a
      WHERE a.n <= $1::int`,
    VOLUME.invoices,
  );

  await run(
    'invoice lines',
    `INSERT INTO billing.invoice_lines
       (id, invoice_id, assignment_id, practitioner_id, hourly_rate_kobo, ordinary_minutes, night_minutes,
        holiday_minutes, overtime_minutes, on_call_minutes, base_kobo, premium_kobo, amount_kobo, created_at)
     SELECT gen_random_uuid(), i.id, a.id, a.user_id, 300000, 720, 0, 0, 0, 0,
            i.gross_kobo, 0, i.gross_kobo, i.created_at
       FROM (
         SELECT row_number() OVER (ORDER BY starts_at, id)::int AS n, id, user_id FROM matching.assignments
       ) a
       JOIN billing.invoices i ON i.id = md5('perf-inv-' || a.n)::uuid
      WHERE a.n <= $1::int`,
    VOLUME.invoices,
  );

  await run(
    'audit entries',
    `INSERT INTO audit.audit_log
       (id, actor_id, actor_type, action, entity_type, entity_id, scope_type, scope_id, created_at)
     SELECT gen_random_uuid(),
            md5('perf-user-' || (1 + n % $2::int))::uuid, 'user',
            (ARRAY['shift.publish','assignment.confirm','attendance.check_in','timesheet.approve',
                   'invoice.issue','credential.review','facility.verify','profile.update'])[1 + n % 8],
            (ARRAY['service_request','assignment','attendance','timesheet','invoice','credential','facility','profile'])[1 + n % 8],
            md5('perf-entity-' || n)::text,
            'FACILITY', md5('perf-facility-' || (1 + n % $3::int))::uuid,
            now() - (n::numeric / $1::numeric) * interval '540 days'
       FROM generate_series(1, $1::int) AS n`,
    VOLUME.auditEntries,
    VOLUME.practitioners,
    VOLUME.facilities,
  );

  await prisma.$executeRawUnsafe('ANALYZE');
  console.log('');
  console.log(`  ${ADMIN_PHONE}  super administrator`);
  console.log(`  ${OWNER_PHONE}  owner of Perf Hospital 001`);
  console.log(`  ${PRACTITIONER_PHONE}  a practitioner`);
  console.log(`  Password: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
