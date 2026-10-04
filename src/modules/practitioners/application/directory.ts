import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { createDownloadUrl } from '@/lib/storage/tigris';
import { normalizeNigerianPhone } from '@/lib/phone';

/**
 * The practitioner directory, for compliance.
 *
 * This deliberately did not exist for a long time. Lookup was by phone number
 * only, following `/grants/find`, on the reasoning that an officer recording a
 * verification has the person in front of them and a browsable roster of
 * everybody on the platform is a different thing with different consequences.
 *
 * It is built now because that reasoning answered the wrong question. An
 * officer working a morning's onboarding does **not** have a number to hand —
 * they have a queue of people who registered overnight and no way to discover
 * who. Requiring a phone number to find somebody meant the only people who
 * could be verified were the ones who had already telephoned to complain.
 *
 * What survives of the original caution is the shape: it is `PLATFORM`-only,
 * it returns what an officer needs to do the job and nothing more, and it is
 * paginated rather than dumping the table.
 *
 * "A practitioner" is somebody holding the practitioner role at `SELF` scope,
 * not somebody with a profile. Registration grants that role through the
 * outbox before any profile exists, and the people most needing verification
 * are exactly the ones who have not filled a profile in yet — defining the
 * list by profile would hide them.
 */

export interface PractitionerListEntry {
  userId: string;
  fullName: string;
  phone: string;
  status: string;
  photoUrl: string | null;
  /** Null when they have not created a profile yet, which is itself worth seeing. */
  professionalCategoryId: string | null;
  yearsOfExperience: number | null;
  identityRecorded: boolean;
  registrationRecorded: boolean;
  createdAt: Date;
}

export interface PractitionerDirectoryPage {
  practitioners: PractitionerListEntry[];
  nextCursor: string | null;
}

export interface ListPractitionersQuery {
  /** Matches a name fragment or a phone number. */
  search?: string;
  limit: number;
  cursor?: string;
}

export async function listPractitioners(
  query: ListPractitionersQuery,
): Promise<PractitionerDirectoryPage> {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    roles: { some: { revokedAt: null, scopeType: 'SELF', role: { key: 'practitioner' } } },
  };

  if (query.search) {
    const search = query.search.trim();
    // A number typed as 0803… has to be matched against the +234… that is
    // stored, and a name has to match however it was capitalised.
    let asPhone: string | null = null;
    try {
      asPhone = normalizeNigerianPhone(search);
    } catch {
      asPhone = null;
    }

    where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { phone: { contains: asPhone ?? search } },
    ];
  }

  const rows = await prisma.user.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      fullName: true,
      phone: true,
      status: true,
      createdAt: true,
      practitionerProfile: {
        select: { photoObjectKey: true, professionalCategoryId: true, yearsOfExperience: true },
      },
      identityVerification: { select: { userId: true } },
      professionalRegistrations: {
        where: { deletedAt: null },
        select: { id: true },
        take: 1,
      },
    },
  });

  const page = rows.slice(0, query.limit);

  const practitioners: PractitionerListEntry[] = await Promise.all(
    page.map(async (row) => ({
      userId: row.id,
      fullName: row.fullName,
      phone: row.phone,
      status: row.status,
      photoUrl: row.practitionerProfile?.photoObjectKey
        ? await createDownloadUrl(row.practitionerProfile.photoObjectKey)
        : null,
      professionalCategoryId: row.practitionerProfile?.professionalCategoryId ?? null,
      yearsOfExperience: row.practitionerProfile?.yearsOfExperience ?? null,
      identityRecorded: Boolean(row.identityVerification),
      registrationRecorded: row.professionalRegistrations.length > 0,
      createdAt: row.createdAt,
    })),
  );

  return {
    practitioners,
    nextCursor:
      rows.length > query.limit ? (practitioners[practitioners.length - 1]?.userId ?? null) : null,
  };
}
