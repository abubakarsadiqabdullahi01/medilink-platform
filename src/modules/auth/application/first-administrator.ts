import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { syncRoles } from '@/lib/authz/sync-roles';
import { hashPassword, passwordProblems } from '@/lib/password';
import { normalizeNigerianPhone } from '@/lib/phone';
import { AuthErrors } from '../domain/errors';

/**
 * The one deliberate way to put the first super administrator into a system.
 *
 * `super_administrator` is never offered in a grant list: it holds every
 * permission there is, and the people who could grant it are the people it
 * would be given to. The scripts that do create one refuse to run outside a
 * developer's machine, because they set a password everyone knows. A new
 * production database therefore had nobody who could appoint anybody, and the
 * only way in was SQL typed by hand.
 *
 * This is that way in, made safe to run:
 *   - the password is chosen by the person running it and goes in as a hash;
 *     nothing here prints it, returns it or writes it anywhere else
 *   - once a super administrator exists it refuses, so a copy of the command
 *     left in a shell history is not a standing way to add another. Adding one
 *     on purpose (every administrator has lost their phone) takes `additional`
 *   - it will not touch an account that already exists, so it cannot be used to
 *     reset somebody's password or to promote a stranger
 *   - it writes an audit row saying it was run and by whom, in the same
 *     transaction as the account, with the ids and none of the person's details
 */
export interface FirstAdministratorInput {
  phone: string;
  fullName: string;
  email?: string;
  password: string;
  /** Who ran the command: a login name or an engineer's handle, for the record. */
  operator: string;
  /** Deliberately adding another when one exists. */
  additional?: boolean;
}

export interface FirstAdministratorResult {
  userId: string;
  phone: string;
}

export async function createFirstAdministrator(
  input: FirstAdministratorInput,
): Promise<FirstAdministratorResult> {
  // Everything that can be refused without touching the database, first.
  const phone = normalizeNigerianPhone(input.phone);
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  const email = input.email?.trim().toLowerCase() || null;

  const problems = passwordProblems(input.password, { phone, fullName, email });
  if (problems.length > 0) throw AuthErrors.passwordRejected(problems);

  // Slow on purpose, so done before the transaction rather than inside it.
  const passwordHash = await hashPassword(input.password);

  // The role rows and their permissions have to exist, and a database that has
  // not been seeded yet has neither. Idempotent and authoritative, so running
  // it here cannot make a seeded database different.
  await syncRoles(prisma);

  return prisma.$transaction(async (tx) => {
    // Two runs at once must not both see "nobody yet".
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('administrator.bootstrap'))`;

    const existing = await tx.userRole.count({
      where: {
        revokedAt: null,
        scopeType: 'PLATFORM',
        role: { key: 'super_administrator' },
        user: { deletedAt: null },
      },
    });
    if (existing > 0 && !input.additional) throw AuthErrors.administratorExists();

    if (await tx.user.findUnique({ where: { phone }, select: { id: true } })) {
      throw AuthErrors.phoneRegistered();
    }
    if (email && (await tx.user.findUnique({ where: { email }, select: { id: true } }))) {
      throw AuthErrors.emailRegistered();
    }

    const user = await tx.user.create({
      data: {
        phone,
        fullName,
        email,
        passwordHash,
        status: 'ACTIVE',
        // Nobody sent a code to this number. Whoever runs the command has the
        // database already, and a code could not be delivered anyway before a
        // messaging provider exists.
        phoneVerifiedAt: new Date(),
      },
    });

    const role = await tx.role.findUniqueOrThrow({ where: { key: 'super_administrator' } });
    const grant = await tx.userRole.create({
      data: { userId: user.id, roleId: role.id, scopeType: 'PLATFORM', scopeId: null },
    });

    await recordAudit(tx, {
      action: 'administrator.bootstrapped',
      entityType: 'identity.users',
      entityId: user.id,
      actorType: 'system',
      scopeType: 'PLATFORM',
      after: {
        grantId: grant.id,
        roleKey: 'super_administrator',
        additional: Boolean(input.additional),
        operator: input.operator,
      },
    });

    return { userId: user.id, phone };
  });
}
