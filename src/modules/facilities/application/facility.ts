import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { loadGrants } from '@/lib/authz/guard';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { createDownloadUrl, createUploadUrl, headObject } from '@/lib/storage/tigris';
import {
  approvalBlockers,
  canPublish,
  normaliseRegistrationReference,
  publishBlockers,
  registrationReferenceProblem,
  type ApprovalChecks,
  type FacilityStatusValue,
  type PublishBlocker,
  type RegistrationKind,
} from '../domain/facility';
import { FacilityErrors } from '../domain/errors';

/**
 * The facility aggregate: create, read, list, edit, verify, and the licence
 * document flow around it. One file, matching
 * credentials/application/submission.ts's precedent.
 */

export interface FacilityView {
  id: string;
  name: string;
  facilityTypeId: string;
  /** Which register `cacNumber` is from; the number itself is a CAC number only for a CAC. */
  registrationKind: RegistrationKind;
  cacNumber: string;
  stateId: string;
  lgaId: string | null;
  addressLine: string;
  contactPhone: string;
  contactEmail: string | null;
  representativeUserId: string;
  status: FacilityStatusValue;
  licenceNumber: string | null;
  licenceObjectKey: string | null;
  licenceExpiresAt: Date | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  reviewNotes: string | null;
  /** What the officer confirmed before approving, if it has been approved. */
  verificationChecks: ApprovalChecks | null;
  /**
   * Derived, never stored. Stage 6 will call canPublish() itself on the way
   * into publishing; surfacing it here is what lets a facility administrator
   * see they are blocked before they try, and why.
   */
  canPublish: boolean;
  publishBlockers: PublishBlocker[];
  createdAt: Date;
  updatedAt: Date;
}

interface FacilityRow {
  id: string;
  name: string;
  facilityTypeId: string;
  registrationKind: RegistrationKind;
  cacNumber: string;
  stateId: string;
  lgaId: string | null;
  addressLine: string;
  contactPhone: string;
  contactEmail: string | null;
  representativeUserId: string;
  status: FacilityStatusValue;
  licenceNumber: string | null;
  licenceObjectKey: string | null;
  licenceExpiresAt: Date | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  reviewNotes: string | null;
  verificationChecks: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function toView(facility: FacilityRow, now: Date = new Date()): FacilityView {
  return {
    id: facility.id,
    name: facility.name,
    facilityTypeId: facility.facilityTypeId,
    registrationKind: facility.registrationKind,
    cacNumber: facility.cacNumber,
    stateId: facility.stateId,
    lgaId: facility.lgaId,
    addressLine: facility.addressLine,
    contactPhone: facility.contactPhone,
    contactEmail: facility.contactEmail,
    representativeUserId: facility.representativeUserId,
    status: facility.status,
    licenceNumber: facility.licenceNumber,
    licenceObjectKey: facility.licenceObjectKey,
    licenceExpiresAt: facility.licenceExpiresAt,
    verifiedBy: facility.verifiedBy,
    verifiedAt: facility.verifiedAt,
    reviewNotes: facility.reviewNotes,
    verificationChecks: (facility.verificationChecks as ApprovalChecks | null) ?? null,
    canPublish: canPublish(facility, now),
    publishBlockers: publishBlockers(facility, now),
    createdAt: facility.createdAt,
    updatedAt: facility.updatedAt,
  };
}

/** The address must be internally consistent, or the facility cannot be found. */
async function assertLgaInState(lgaId: string, stateId: string): Promise<void> {
  const lga = await prisma.lga.findUnique({ where: { id: lgaId } });
  if (!lga || lga.stateId !== stateId) throw FacilityErrors.lgaNotInState();
}

/**
 * Mirrors confirmDocumentOwnership in credentials, keyed on the facility
 * rather than the user: a licence uploaded for facility A must not be
 * attachable to facility B.
 */
async function confirmLicenceReference(facilityId: string, objectKey: string): Promise<void> {
  const stored = await prisma.storedObject.findUnique({ where: { objectKey } });
  if (
    !stored ||
    stored.purpose !== 'facility_licence' ||
    stored.scopeType !== 'FACILITY' ||
    stored.scopeId !== facilityId ||
    stored.deletedAt
  ) {
    throw FacilityErrors.invalidLicenceReference();
  }
  try {
    await headObject(objectKey);
  } catch {
    throw FacilityErrors.invalidLicenceReference();
  }
}

/** Its own audit row: confirmation can happen in a later, unrelated request. */
async function confirmLicenceUpload(
  tx: Tx,
  facilityId: string,
  actorId: string,
  objectKey: string,
): Promise<void> {
  const updated = await tx.storedObject.update({
    where: { objectKey },
    data: { uploadedAt: new Date() },
  });

  await recordAudit(tx, {
    action: 'facility.licence_confirmed',
    entityType: 'storage.stored_objects',
    entityId: updated.id,
    actorId,
    scopeType: 'FACILITY',
    scopeId: facilityId,
  });
}

export interface CreateFacilityParams {
  name: string;
  facilityTypeId: string;
  /** Defaults to a CAC registration. */
  registrationKind?: RegistrationKind;
  /** The registration reference: a CAC number for a company, a ministry or board reference otherwise. */
  cacNumber: string;
  stateId: string;
  lgaId?: string;
  addressLine: string;
  contactPhone: string;
  contactEmail?: string;
  representativeUserId: string;
  licenceNumber?: string;
  licenceExpiresAt?: Date;
  /** The operations user creating the record, not the representative. */
  actorId: string;
}

/**
 * Creates the facility and grants its representative facility_owner over it,
 * in one transaction.
 *
 * The grant happens here rather than through the outbox, unlike
 * grantPractitionerRoleOnRegistration: that one had to react to an event
 * because registration's transaction had no facility to scope a grant to.
 * Here the id exists in the same transaction, and a facility whose
 * representative cannot reach it is not something worth half-creating.
 */
export async function createFacility(input: CreateFacilityParams): Promise<FacilityView> {
  const facilityType = await prisma.facilityType.findUnique({
    where: { id: input.facilityTypeId },
  });
  if (!facilityType) throw FacilityErrors.facilityTypeNotFound();

  const state = await prisma.state.findUnique({ where: { id: input.stateId } });
  if (!state) throw FacilityErrors.stateNotFound();

  if (input.lgaId) await assertLgaInState(input.lgaId, input.stateId);

  const representative = await prisma.user.findUnique({
    where: { id: input.representativeUserId },
    select: { id: true, deletedAt: true },
  });
  if (!representative || representative.deletedAt) throw FacilityErrors.representativeNotFound();

  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'facility_owner' } });

  // Whoever calls this gets the same normalisation and the same rule, not only the
  // callers that went through a schema.
  const registrationKind = input.registrationKind ?? 'CAC';
  const reference = normaliseRegistrationReference(registrationKind, input.cacNumber);
  const referenceProblem = registrationReferenceProblem(registrationKind, reference);
  if (referenceProblem) throw FacilityErrors.invalidRegistrationReference(referenceProblem);

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.facility.create({
        data: {
          name: input.name,
          facilityTypeId: input.facilityTypeId,
          registrationKind,
          cacNumber: reference,
          stateId: input.stateId,
          lgaId: input.lgaId,
          addressLine: input.addressLine,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          representativeUserId: input.representativeUserId,
          licenceNumber: input.licenceNumber,
          licenceExpiresAt: input.licenceExpiresAt,
        },
      });

      await recordAudit(tx, {
        action: 'facility.created',
        entityType: 'facilities.facilities',
        entityId: created.id,
        actorId: input.actorId,
        scopeType: 'FACILITY',
        scopeId: created.id,
        after: toView(created),
      });

      const grant = await tx.userRole.create({
        data: {
          userId: input.representativeUserId,
          roleId: role.id,
          scopeType: 'FACILITY',
          scopeId: created.id,
          grantedBy: input.actorId,
        },
      });

      await recordAudit(tx, {
        action: 'facility.role_granted',
        entityType: 'identity.user_roles',
        entityId: grant.id,
        actorId: input.actorId,
        scopeType: 'FACILITY',
        scopeId: created.id,
        after: { roleKey: 'facility_owner', userId: input.representativeUserId },
      });

      return toView(created);
    });
  } catch (error) {
    // Refused by the constraint rather than by a prior read: two concurrent
    // creations of the same registration number cannot both win.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw FacilityErrors.duplicateCacNumber();
    }
    throw error;
  }
}

/**
 * Whether this facility may add people to itself, and look people up to do so.
 *
 * Registering a facility makes the registrant its owner at once, and the owner's
 * bundle carries `role.grant` — which includes finding any registered user by
 * phone number. The permission guard proves permission and scope and never asks
 * what state the facility is in, so until a facility had been verified its
 * owner, who had proved nothing to anybody, held a directory search over every
 * practitioner on the platform (AUT-07).
 *
 * `VERIFIED` and nothing else: a facility that is pending, rejected or
 * suspended has not been checked against its registration. A licence out of date
 * does not stop it — publishing shifts needs that (`canPublish`), but the
 * owner of a verified hospital managing their own staff does not.
 *
 * "No such facility" gets the same answer as "not verified". The caller's grant
 * has already been proved by the time this runs, so there is nothing to hide and
 * nothing to gain from telling the two apart.
 */
export async function assertFacilityVerified(facilityId: string): Promise<void> {
  const facility = await prisma.facility.findFirst({
    where: { id: facilityId, deletedAt: null },
    select: { status: true },
  });
  if (!facility || facility.status !== 'VERIFIED')
    throw FacilityErrors.staffNeedsVerifiedFacility();
}

/**
 * The route-level form of the above, for a caller the guard has already
 * approved to give out `role.grant` over `scope`.
 *
 * It is a limit on authority that comes *from the facility*: the owner's own
 * grant, made at registration and never checked by anybody. Somebody who holds
 * `role.grant` at the platform has been given it by the platform, is the one who
 * does the verifying, and may add people to a hospital still being onboarded —
 * that is a step-up-protected, audited act of operations rather than the
 * facility reaching for itself. So the question is where the caller's authority
 * comes from, not which scope they named.
 *
 * Only a facility scope is checked. Any other scope a facility owner could name
 * is refused earlier by the guard: their grant is for the facility, and the
 * facility is an ancestor of nothing else they could name.
 */
export async function assertScopeMayAddStaff(
  scope: { type: string; id?: string },
  actorId: string,
): Promise<void> {
  if (scope.type !== 'FACILITY' || !scope.id) return;

  const grants = await loadGrants(actorId);
  const grantedByThePlatform = grants.some(
    (grant) => grant.permission === 'role.grant' && grant.scopeType === 'PLATFORM',
  );
  if (grantedByThePlatform) return;

  await assertFacilityVerified(scope.id);
}

export async function getFacility(facilityId: string): Promise<FacilityView> {
  const facility = await prisma.facility.findFirst({
    where: { id: facilityId, deletedAt: null },
  });
  if (!facility) throw FacilityErrors.facilityNotFound();
  return toView(facility);
}

export interface ListFacilitiesQuery {
  scopeType: 'PLATFORM' | 'FACILITY';
  scopeId?: string;
  status?: FacilityStatusValue;
  stateId?: string;
  /** Matches the facility name or its CAC number. */
  search?: string;
  limit: number;
  cursor?: string;
}

export interface FacilitiesPage {
  facilities: FacilityView[];
  nextCursor: string | null;
}

export async function listFacilities(query: ListFacilitiesQuery): Promise<FacilitiesPage> {
  const where: Prisma.FacilityWhereInput = { deletedAt: null };

  // FACILITY scope is confined to the one facility the caller was authorised
  // for; PLATFORM applies no filter unless one is given, as an optional
  // narrowing for an operations lookup.
  if (query.scopeType !== 'PLATFORM' || query.scopeId) {
    where.id = query.scopeId;
  }

  if (query.status) where.status = query.status;
  if (query.stateId) where.stateId = query.stateId;

  // Name or CAC number. An officer with a hospital's paperwork in front of
  // them has one or the other, and "Self Registered Clinic 17443486" is not
  // something anybody scrolls to find.
  if (query.search) {
    const search = query.search.trim();
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { cacNumber: { contains: search, mode: 'insensitive' } },
    ];
  }

  const rows = await prisma.facility.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const facilities = rows.slice(0, query.limit).map((row) => toView(row));
  const hasMore = rows.length > query.limit;

  return {
    facilities,
    nextCursor: hasMore ? (facilities[facilities.length - 1]?.id ?? null) : null,
  };
}

export interface UpdateFacilityParams {
  facilityId: string;
  actorId: string;
  name?: string;
  addressLine?: string;
  lgaId?: string;
  contactPhone?: string;
  contactEmail?: string;
  licenceNumber?: string;
  licenceObjectKey?: string;
  licenceExpiresAt?: Date;
  /** Only for a refused facility: correct the registration number. */
  cacNumber?: string;
  /** Only with a corrected number: it was registered under the wrong register. */
  registrationKind?: RegistrationKind;
  /**
   * Send a refused facility back to compliance with these corrections. Explicit
   * rather than implied by any edit, so an owner tidying an address while
   * refused does not put an unfinished correction in front of a reviewer.
   */
  resubmit?: boolean;
}

const LICENCE_FIELDS = ['licenceNumber', 'licenceObjectKey', 'licenceExpiresAt'] as const;

export async function updateFacility(input: UpdateFacilityParams): Promise<FacilityView> {
  const existing = await prisma.facility.findFirst({
    where: { id: input.facilityId, deletedAt: null },
  });
  if (!existing) throw FacilityErrors.facilityNotFound();

  if (input.lgaId) await assertLgaInState(input.lgaId, existing.stateId);
  if (input.licenceObjectKey) await confirmLicenceReference(existing.id, input.licenceObjectKey);

  // The registration number is the facility's identity. A verified one cannot
  // be swapped for another by an edit, and a pending one is what compliance is
  // looking at; it can be corrected only after a refusal, which is when it is
  // most often the thing that was wrong.
  const registrationKind = input.registrationKind ?? existing.registrationKind;
  const cacNumber =
    input.cacNumber === undefined
      ? undefined
      : normaliseRegistrationReference(registrationKind, input.cacNumber);
  if (
    (cacNumber !== undefined || input.registrationKind !== undefined) &&
    existing.status !== 'REJECTED'
  ) {
    throw FacilityErrors.cacLocked();
  }
  if (cacNumber !== undefined) {
    const problem = registrationReferenceProblem(registrationKind, cacNumber);
    if (problem) throw FacilityErrors.invalidRegistrationReference(problem);
  }

  /**
   * Resubmitting a refused facility. Verification needed a PENDING facility and
   * the number could not be edited, so a refusal was final: the dashboard told
   * the owner to reply with corrected documents and offered no way to.
   *
   * Something has to have changed. A facility sent back unchanged would be
   * refused for the same reason, and a loop between the two helps nobody.
   */
  const resubmitting = input.resubmit === true;
  if (resubmitting) {
    if (existing.status !== 'REJECTED') throw FacilityErrors.notRejected();

    const changed =
      (cacNumber !== undefined && cacNumber !== existing.cacNumber) ||
      (input.registrationKind !== undefined && input.registrationKind !== existing.registrationKind) ||
      (input.name !== undefined && input.name !== existing.name) ||
      (input.addressLine !== undefined && input.addressLine !== existing.addressLine) ||
      (input.lgaId !== undefined && input.lgaId !== existing.lgaId) ||
      (input.contactPhone !== undefined && input.contactPhone !== existing.contactPhone) ||
      (input.contactEmail !== undefined && input.contactEmail !== existing.contactEmail) ||
      (input.licenceNumber !== undefined && input.licenceNumber !== existing.licenceNumber) ||
      (input.licenceObjectKey !== undefined &&
        input.licenceObjectKey !== existing.licenceObjectKey) ||
      (input.licenceExpiresAt !== undefined &&
        input.licenceExpiresAt.getTime() !== existing.licenceExpiresAt?.getTime());
    if (!changed) throw FacilityErrors.nothingChanged();
  }

  /**
   * Changing the licence of an already-verified facility sends it back for
   * review. Without this, verification would mean only that some licence was
   * approved once — a facility could swap the document afterwards and keep
   * publishing on the strength of a review nobody did. Name, address and
   * contact details are not evidence, so they do not reset it.
   */
  const licenceChanged = LICENCE_FIELDS.some((field) => input[field] !== undefined);
  const resetForReview = licenceChanged && existing.status === 'VERIFIED';

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.facility.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          registrationKind: input.registrationKind,
          cacNumber,
          addressLine: input.addressLine,
          lgaId: input.lgaId,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          licenceNumber: input.licenceNumber,
          licenceObjectKey: input.licenceObjectKey,
          licenceExpiresAt: input.licenceExpiresAt,
          ...(resetForReview || resubmitting
            ? { status: 'PENDING', verifiedBy: null, verifiedAt: null, reviewNotes: null }
            : {}),
        },
      });

      if (input.licenceObjectKey) {
        await confirmLicenceUpload(tx, existing.id, input.actorId, input.licenceObjectKey);
      }

      await recordAudit(tx, {
        action: resubmitting
          ? 'facility.resubmitted'
          : resetForReview
            ? 'facility.licence_replaced'
            : 'facility.updated',
        entityType: 'facilities.facilities',
        entityId: updated.id,
        actorId: input.actorId,
        scopeType: 'FACILITY',
        scopeId: updated.id,
        reason: resubmitting
          ? 'Corrected and sent back for review'
          : resetForReview
            ? 'Licence changed; returned for review'
            : undefined,
        before: toView(existing),
        after: toView(updated),
      });

      return toView(updated);
    });
  } catch (error) {
    // Refused by the constraint rather than by a prior read, as at creation.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw FacilityErrors.duplicateCacNumber();
    }
    throw error;
  }
}

export interface VerifyFacilityParams {
  facilityId: string;
  verifierId: string;
  decision: 'approve' | 'reject';
  reviewNotes?: string;
  /** What the officer confirmed, kept on the facility. Required by `reviewFacility` to approve. */
  checks?: ApprovalChecks;
}

const APPROVAL_BLOCKER_WORDS = {
  no_licence_document: 'no licence document has been uploaded',
  no_licence_number: 'no licence number is recorded',
  checks_incomplete:
    'the checks have not all been confirmed (licence seen, licence matches the facility, registration checked)',
  checked_with_missing: 'say how the registration was checked',
} as const;

/**
 * Approves or refuses a facility the way an officer does: approval needs the
 * licence document and number on file and every check confirmed, with how the
 * registration was checked in words (UXO-02). "Verify" was a live button whether
 * or not a licence was on file, and recorded only a free-text note.
 *
 * `verifyFacility` below does no such check and stays as it was, because the
 * seed and the tests build worlds of verified facilities with no document to
 * show; this is the path a person takes.
 */
export async function reviewFacility(input: VerifyFacilityParams): Promise<FacilityView> {
  if (input.decision === 'approve') {
    const existing = await prisma.facility.findFirst({
      where: { id: input.facilityId, deletedAt: null },
      select: { licenceObjectKey: true, licenceNumber: true },
    });
    if (!existing) throw FacilityErrors.facilityNotFound();

    const blockers = approvalBlockers(existing, input.checks);
    if (blockers.length > 0) {
      throw FacilityErrors.approvalBlocked(blockers.map((blocker) => APPROVAL_BLOCKER_WORDS[blocker]));
    }
  }
  return verifyFacility(input);
}

export async function verifyFacility(input: VerifyFacilityParams): Promise<FacilityView> {
  const existing = await prisma.facility.findFirst({
    where: { id: input.facilityId, deletedAt: null },
  });
  if (!existing) throw FacilityErrors.facilityNotFound();

  // Nothing else stops a user holding both facility_owner and
  // administrator from verifying the facility they represent.
  if (existing.representativeUserId === input.verifierId) {
    throw FacilityErrors.cannotVerifyOwnFacility();
  }
  if (existing.status !== 'PENDING') throw FacilityErrors.alreadyVerified();

  const now = new Date();
  const approved = input.decision === 'approve';

  return prisma.$transaction(async (tx) => {
    // Conditional on the status just read, so two concurrent reviews cannot
    // both apply — the same shape reviewCredential uses.
    const applied = await tx.facility.updateMany({
      where: { id: existing.id, status: 'PENDING' },
      data: {
        status: approved ? 'VERIFIED' : 'REJECTED',
        verifiedBy: input.verifierId,
        verifiedAt: now,
        reviewNotes: input.reviewNotes,
        ...(approved && input.checks ? { verificationChecks: { ...input.checks } } : {}),
      },
    });
    if (applied.count !== 1) throw FacilityErrors.alreadyVerified();

    const updated = await tx.facility.findUniqueOrThrow({ where: { id: existing.id } });

    // Scoped to the facility, not the reviewer: the facility's own people
    // must see this in their FACILITY-scoped audit history. actorId is who
    // actually decided — deliberately a different person.
    await recordAudit(tx, {
      action: approved ? 'facility.verified' : 'facility.rejected',
      entityType: 'facilities.facilities',
      entityId: updated.id,
      actorId: input.verifierId,
      scopeType: 'FACILITY',
      scopeId: updated.id,
      reason: input.reviewNotes,
      before: toView(existing),
      after: { ...toView(updated), ...(approved && input.checks ? { checks: input.checks } : {}) },
    });

    // No event on reject — none exists in the vocabulary, and the audit row
    // is the record. FacilityVerified has no handler yet, so the worker's
    // no-handler path marks it processed rather than retrying it forever.
    if (approved) {
      await publishEvent(tx, {
        eventType: EVENTS.FacilityVerified,
        aggregateType: 'facilities.facilities',
        aggregateId: updated.id,
        payload: {
          facilityId: updated.id,
          representativeUserId: updated.representativeUserId,
          stateId: updated.stateId,
        },
      });
    }

    return toView(updated);
  });
}

export interface RequestLicenceUploadUrlParams {
  facilityId: string;
  actorId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface LicenceUploadUrl {
  objectKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export async function requestLicenceUploadUrl(
  input: RequestLicenceUploadUrlParams,
): Promise<LicenceUploadUrl> {
  const facility = await prisma.facility.findFirst({
    where: { id: input.facilityId, deletedAt: null },
    select: { id: true },
  });
  if (!facility) throw FacilityErrors.facilityNotFound();

  // Keyed by facility, not by uploader: the licence belongs to the
  // organisation and outlives whoever happened to upload it.
  const { objectKey, url, expiresInSeconds } = await createUploadUrl({
    purpose: 'facility_licence',
    ownerId: facility.id,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });

  await prisma.$transaction(async (tx) => {
    const stored = await tx.storedObject.create({
      data: {
        bucket: env.STORAGE_BUCKET,
        objectKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        purpose: 'facility_licence',
        ownerUserId: input.actorId,
        scopeType: 'FACILITY',
        scopeId: facility.id,
      },
    });

    await recordAudit(tx, {
      action: 'facility.licence_upload_requested',
      entityType: 'storage.stored_objects',
      entityId: stored.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: facility.id,
      after: { objectKey, contentType: input.contentType, sizeBytes: input.sizeBytes },
    });
  });

  return { objectKey, uploadUrl: url, expiresInSeconds };
}

export interface RequestLicenceDownloadUrlParams {
  facilityId: string;
  viewerId: string;
}

export interface LicenceDownloadUrl {
  downloadUrl: string;
  expiresInSeconds: number;
}

export async function requestLicenceDownloadUrl(
  input: RequestLicenceDownloadUrlParams,
): Promise<LicenceDownloadUrl> {
  const facility = await prisma.facility.findFirst({
    where: { id: input.facilityId, deletedAt: null },
    select: { id: true, licenceObjectKey: true },
  });
  if (!facility) throw FacilityErrors.facilityNotFound();
  if (!facility.licenceObjectKey) throw FacilityErrors.noLicenceOnFacility();

  const downloadUrl = await createDownloadUrl(facility.licenceObjectKey);

  // A read, not a state change: evidence in security_events rather than a
  // coverage-checked audit_log row, the same reasoning
  // requestDocumentDownloadUrl and recordAuditTrailAccess already use.
  await prisma.securityEvent.create({
    data: {
      userId: input.viewerId,
      kind: 'facility.licence_accessed',
      severity: 'info',
      detail: { facilityId: facility.id },
    },
  });

  return { downloadUrl, expiresInSeconds: env.STORAGE_SIGNED_URL_TTL_SECONDS };
}
