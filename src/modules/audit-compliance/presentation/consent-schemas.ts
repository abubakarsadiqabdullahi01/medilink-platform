import { z } from 'zod';

const uuid = z.string().uuid();

export const recordConsentSchema = z.object({
  purpose: z.enum([
    'IDENTITY_VERIFICATION',
    'CREDENTIAL_SHARING',
    'PROFILE_VISIBILITY',
    'MARKETING',
  ]),
  granted: z.boolean(),
  // Required on withdrawal, which the application layer enforces too — the
  // record has to say what changed and why.
  note: z.string().trim().max(500).optional(),
});

export const emptySelfSchema = z.object({});

export const acceptAgreementSchema = z.object({ versionId: uuid });

/** The facility console's side: who is asking is the person, the scope is the facility. */
export const facilityAgreementsSchema = z.object({ facilityId: uuid });
export const acceptFacilityAgreementSchema = z.object({ facilityId: uuid, versionId: uuid });

export const listVersionsSchema = z.object({});

export const publishAgreementSchema = z.object({
  kind: z.enum(['PRACTITIONER_ENGAGEMENT', 'FACILITY_TERMS', 'PRIVACY_NOTICE']),
  // Stable and human-readable: the specification is explicit that the version
  // identifier is stored, not the file name.
  identifier: z.string().trim().min(3).max(120),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(50),
  effectiveFrom: z.coerce.date().optional(),
});

export const raiseRequestSchema = z.object({
  kind: z.enum(['ACCESS', 'RECTIFICATION', 'ERASURE', 'PORTABILITY', 'RESTRICTION']),
  detail: z.string().trim().max(1000).optional(),
});

/** Picking a request up. The id is the whole of it. */
export const startRequestSchema = z.object({ id: uuid });

export const closeRequestSchema = z.object({
  id: uuid,
  status: z.enum(['COMPLETED', 'REFUSED']),
  outcome: z.string().trim().min(10).max(2000),
});

export const listRequestsSchema = z.object({
  status: z.enum(['RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REFUSED']).optional(),
  kind: z.enum(['ACCESS', 'RECTIFICATION', 'ERASURE', 'PORTABILITY', 'RESTRICTION']).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: uuid.optional(),
});
