import type { PrismaClient } from '@prisma/client';

/**
 * Stage 4.5 harness: the test suite fails if a state change leaves no audit
 * row.
 *
 * The rule in src/lib/audit.ts is only as good as its weakest call site. A
 * developer adding a service that updates a row and forgets `recordAudit`
 * breaks nothing visible — the endpoint works, the tests pass, and the gap is
 * discovered months later when someone asks who changed a payout account.
 * This module observes every write the application makes during a test and
 * reports the ones no audit row accounts for.
 *
 * It is machinery for tests, not for request handling; nothing under
 * src/app or src/modules imports it. The registry lives here rather than in
 * the test folder because it is a statement about the schema: a developer
 * adding a model has to decide, in this file, whether writes to it are
 * audited or self-evidencing, and say why.
 */

/**
 * Models whose rows are domain state. A write to any of these must be
 * accompanied by an audit row naming the same table.
 */
export const AUDITED_MODELS: Readonly<Record<string, string>> = {
  User: 'identity.users',
  Role: 'identity.roles',
  Permission: 'identity.permissions',
  RolePermission: 'identity.role_permissions',
  UserRole: 'identity.user_roles',
  Session: 'identity.sessions',
  Device: 'identity.devices',
  OtpCode: 'identity.otp_codes',
  ProfessionalCategory: 'config.professional_categories',
  Specialty: 'config.specialties',
  CredentialType: 'config.credential_types',
  State: 'config.states',
  Lga: 'config.lgas',
  FacilityType: 'config.facility_types',
  PublicHoliday: 'config.public_holidays',
  RateFloor: 'config.rate_floors',
  StoredObject: 'storage.stored_objects',
  PractitionerProfile: 'practitioners.practitioner_profiles',
  CredentialSubmission: 'credentials.credential_submissions',
  Facility: 'facilities.facilities',
  IdentityVerification: 'practitioners.identity_verifications',
  ProfessionalRegistration: 'practitioners.professional_registrations',
};

/**
 * Models exempt from the rule, each with the reason. An exemption is a
 * decision, so it is written down rather than implied by absence.
 */
export const EXEMPT_MODELS: Readonly<Record<string, string>> = {
  AuditLog:
    'It is the audit record. Auditing the audit trail is circular, and the table has no update or delete path.',
  OutboxEvent:
    'Delivery bookkeeping, not domain state. The state change that published the event is audited; attempt counts and backoff are not decisions anyone made.',
  SecurityEvent:
    'Append-only security evidence in its own right, written by the platform rather than by an actor.',
  LoginAttempt:
    'Append-only evidence of every sign-in attempt, and the input to the lockout throttle. Auditing each failed guess would bury real state changes under noise.',
  ScheduledJob:
    'Scheduling bookkeeping, not domain state. A nextRunAt or a failure count is not a decision anyone made; what a sweep actually changed is audited by the sweep itself.',
};

const MUTATIONS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

const BULK_ACTIONS = new Set(['createMany', 'updateMany', 'deleteMany']);

export interface RecordedWrite {
  model: string;
  entityType: string;
  action: string;
  rows: number;
}

export interface RecordedAudit {
  action: string;
  entityType: string;
  entityId: string | null;
}

export interface CoverageReport {
  writes: RecordedWrite[];
  audits: RecordedAudit[];
  /** Writes to an audited table with no audit row naming that table. */
  unaudited: RecordedWrite[];
  /** Audit rows naming a table that does not exist — usually a typo in recordAudit. */
  unknownEntityTypes: string[];
}

interface Buffers {
  writes: RecordedWrite[];
  audits: RecordedAudit[];
}

let buffers: Buffers | null = null;
let installed = false;

const KNOWN_ENTITY_TYPES = new Set<string>(Object.values(AUDITED_MODELS));

/** Bulk writes that matched nothing changed nothing, so they need no audit row. */
function rowsAffected(action: string, result: unknown): number {
  if (BULK_ACTIONS.has(action)) {
    const count = (result as { count?: number } | null)?.count;
    return typeof count === 'number' ? count : 0;
  }
  return 1;
}

function collectAuditRows(action: string, args: unknown): RecordedAudit[] {
  const data = (args as { data?: unknown } | undefined)?.data;
  const rows = Array.isArray(data) ? data : data ? [data] : [];

  return rows.map((row) => {
    const record = row as { action?: unknown; entityType?: unknown; entityId?: unknown };
    return {
      action: typeof record.action === 'string' ? record.action : `<${action}>`,
      entityType: typeof record.entityType === 'string' ? record.entityType : '<missing>',
      entityId: typeof record.entityId === 'string' ? record.entityId : null,
    };
  });
}

/**
 * Attaches the observer to the shared client. Middleware rather than a client
 * extension because application code imports the `prisma` singleton directly:
 * an extended client would be a different object that nothing under test
 * would use.
 *
 * Idempotent, and inert until startAuditCoverage() opens a recording window,
 * so it costs nothing on the queries a test runs while arranging fixtures.
 */
export function installAuditCoverage(client: PrismaClient): void {
  if (installed) return;
  installed = true;

  client.$use(async (params, next) => {
    const result = await next(params);

    const model = params.model;
    if (!buffers || !model || !MUTATIONS.has(params.action)) return result;

    if (model === 'AuditLog') {
      buffers.audits.push(...collectAuditRows(params.action, params.args));
      return result;
    }

    const entityType = AUDITED_MODELS[model];
    if (!entityType) return result;

    const rows = rowsAffected(params.action, result);
    if (rows > 0) {
      buffers.writes.push({ model, entityType, action: params.action, rows });
    }

    return result;
  });
}

/** Opens a recording window, discarding anything recorded before it. */
export function startAuditCoverage(): void {
  buffers = { writes: [], audits: [] };
}

/** Closes the recording window. Writes after this point are ignored. */
export function stopAuditCoverage(): void {
  buffers = null;
}

export function auditCoverageReport(): CoverageReport {
  const current = buffers ?? { writes: [], audits: [] };
  const auditedTables = new Set(current.audits.map((row) => row.entityType));

  return {
    writes: [...current.writes],
    audits: [...current.audits],
    unaudited: current.writes.filter((write) => !auditedTables.has(write.entityType)),
    unknownEntityTypes: [
      ...new Set(
        current.audits
          .map((row) => row.entityType)
          .filter((entityType) => !KNOWN_ENTITY_TYPES.has(entityType)),
      ),
    ],
  };
}

/**
 * A readable account of what the window found, or null when it is clean.
 * Returning the message rather than throwing keeps this file free of a test
 * framework, so it can also be run from a script.
 */
export function describeCoverageFailure(report: CoverageReport): string | null {
  const problems: string[] = [];

  if (report.unaudited.length > 0) {
    const lines = report.unaudited
      .map((write) => `  ${write.model}.${write.action} wrote ${write.rows} row(s) to ${write.entityType}`)
      .sort();
    problems.push(
      `${report.unaudited.length} write(s) left no audit row:\n${[...new Set(lines)].join('\n')}`,
    );
  }

  if (report.unknownEntityTypes.length > 0) {
    problems.push(
      `Audit rows name ${report.unknownEntityTypes.length} table(s) that do not exist: ` +
        `${report.unknownEntityTypes.join(', ')}. Check the entityType passed to recordAudit.`,
    );
  }

  return problems.length > 0 ? problems.join('\n\n') : null;
}
