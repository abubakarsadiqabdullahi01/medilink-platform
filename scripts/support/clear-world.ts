import type { PrismaClient } from '@prisma/client';

/**
 * Removes a world a script built earlier, so the script can run again.
 *
 * A "world" is recognised by its tags rather than by ids remembered from the
 * last run: users by an email domain the script owns, facilities by a CAC
 * prefix, agreements by an identifier prefix. `.test` is a reserved
 * top-level domain, so a tagged address can never reach a real inbox — and
 * nobody outside the script will ever register one.
 *
 * Invitations, suggestions, notifications, stored objects and ledger rows
 * carry no foreign key back to a user or a facility, so each is found
 * explicitly rather than trusted to cascade. Assignments go before requests
 * and users because both keys are Restrict, which is right: removing a
 * facility must never silently remove the shifts somebody worked for it.
 *
 * The audit trail is left alone. It is append-only by design, and a row
 * naming somebody who no longer exists is exactly what it is for.
 */
export interface WorldTags {
  emailDomain: string;
  cacPrefix: string;
  /** Older runs tagged users by an email prefix instead of a domain. */
  legacyEmailPrefix?: string;
  agreementPrefix?: string;
  sanctionsOwner?: string;
}

export interface ClearedWorld {
  users: number;
  facilities: number;
}

export async function clearWorld(prisma: PrismaClient, tags: WorldTags): Promise<ClearedWorld> {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { endsWith: `@${tags.emailDomain}` } },
        ...(tags.legacyEmailPrefix ? [{ email: { startsWith: tags.legacyEmailPrefix } }] : []),
      ],
    },
    select: { id: true },
  });
  const userIds = users.map((row) => row.id);
  const facilities = await prisma.facility.findMany({
    where: { cacNumber: { startsWith: tags.cacPrefix } },
    select: { id: true },
  });
  const facilityIds = facilities.map((row) => row.id);
  const versions = tags.agreementPrefix
    ? await prisma.agreementVersion.findMany({
        where: { identifier: { startsWith: tags.agreementPrefix } },
        select: { id: true },
      })
    : [];
  const versionIds = versions.map((row) => row.id);

  if (userIds.length > 0 || facilityIds.length > 0) {
    const requests = await prisma.serviceRequest.findMany({
      where: { facilityId: { in: facilityIds } },
      select: { id: true },
    });
    const requestIds = requests.map((row) => row.id);
    const invitations = await prisma.invitation.findMany({
      where: { OR: [{ serviceRequestId: { in: requestIds } }, { userId: { in: userIds } }] },
      select: { id: true },
    });

    /**
     * Whole transactions, not entries by subject.
     *
     * `CASH` and `PLATFORM_REVENUE` carry no subject, so deleting by subject
     * removes one side of a payment and leaves the other — which is how a
     * re-run once left the ledger holding half-transactions and a balance
     * that should have been zero.
     */
    const touched = await prisma.ledgerEntry.findMany({
      where: { subjectId: { in: [...userIds, ...facilityIds] } },
      select: { transactionId: true },
      distinct: ['transactionId'],
    });
    await prisma.ledgerEntry.deleteMany({
      where: { transactionId: { in: touched.map((row) => row.transactionId) } },
    });
    await prisma.payout.deleteMany({ where: { practitionerId: { in: userIds } } });
    await prisma.invoice.deleteMany({ where: { facilityId: { in: facilityIds } } });
    await prisma.clinicalIncident.deleteMany({ where: { facilityId: { in: facilityIds } } });
    await prisma.suggestion.deleteMany({
      where: {
        OR: [{ raisedBy: { in: userIds } }, { sourceRef: { in: invitations.map((row) => row.id) } }],
      },
    });
    await prisma.notificationMessage.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.assignment.deleteMany({
      where: { OR: [{ serviceRequestId: { in: requestIds } }, { userId: { in: userIds } }] },
    });
    await prisma.invitation.deleteMany({ where: { id: { in: invitations.map((row) => row.id) } } });
    await prisma.serviceRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.facility.deleteMany({ where: { id: { in: facilityIds } } });
    await prisma.storedObject.deleteMany({
      where: { OR: [{ ownerUserId: { in: userIds } }, { scopeId: { in: facilityIds } }] },
    });
  }

  // Acceptances are Restrict against the version, and anybody — not only a
  // tagged account — may have accepted one while clicking around.
  if (versionIds.length > 0) {
    await prisma.agreementAcceptance.deleteMany({ where: { versionId: { in: versionIds } } });
  }
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (versionIds.length > 0) {
    await prisma.agreementVersion.deleteMany({ where: { id: { in: versionIds } } });
  }

  if (tags.sanctionsOwner) {
    await prisma.screeningResult.deleteMany({ where: { matchedEntry: { owner: tags.sanctionsOwner } } });
    await prisma.sanctionedEntry.deleteMany({ where: { owner: tags.sanctionsOwner } });
  }

  return { users: userIds.length, facilities: facilityIds.length };
}
