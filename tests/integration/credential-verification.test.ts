import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

// Only headObject touches the network; getSignedUrl (inside createUploadUrl
// and createDownloadUrl) is local signing and stays real.
vi.mock('@/lib/storage/tigris', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/tigris')>();
  return { ...actual, headObject: vi.fn().mockResolvedValue({}) };
});

import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import { GET, POST } from '@/app/api/v1/credentials/route';
import { POST as postDocumentUploadUrl } from '@/app/api/v1/credentials/document-upload-url/route';
import { POST as postReview } from '@/app/api/v1/credentials/[id]/review/route';
import { POST as postDocumentUrl } from '@/app/api/v1/credentials/[id]/document-url/route';
import { PATCH as patchSubmission } from '@/app/api/v1/credentials/[id]/route';
import { ROUTES } from '@/modules/credentials/routes';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { createCredentialType, createUser, grant } from './support/fixtures';

/**
 * Stage 5.2 — credential submission, review and document access. The first
 * module where one user (a compliance officer) acts on another user's
 * resource, so this is also the first place isAuthorized's PLATFORM scope
 * gets exercised end to end, not just unit-tested.
 */

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

async function jsonRequest(url: string, body: unknown): Promise<Request> {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callSubmit(body: unknown): Promise<ApiResult> {
  const response = await POST(await jsonRequest('http://localhost/api/v1/credentials', body));
  return { status: response.status, body: await response.json() };
}

async function callList(query: Record<string, string>): Promise<ApiResult> {
  const params = new URLSearchParams(query);
  const response = await GET(new Request(`http://localhost/api/v1/credentials?${params}`));
  return { status: response.status, body: await response.json() };
}

async function callUploadUrl(body: unknown = {}): Promise<ApiResult> {
  const response = await postDocumentUploadUrl(
    await jsonRequest('http://localhost/api/v1/credentials/document-upload-url', {
      filename: 'licence.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      ...(body as object),
    }),
  );
  return { status: response.status, body: await response.json() };
}

/**
 * A waiting submission of a document-reviewed credential — the kind an officer
 * approves in one click. The tests of review *mechanics* (one winner among
 * concurrent reviews, no reviewing your own, the resupply round trip) use this
 * rather than a NIN: a NIN or a licence number is confirmed through the
 * practitioner's page instead, because approving it has to record the identity
 * or registration too. That path is in confirm-from-submission.test.ts.
 */
async function submitDocumentCredential(options: { expires?: boolean; reviewDays?: number } = {}) {
  const credentialType = await createCredentialType({
    verificationMethod: 'document_review',
    ...options,
  });
  const upload = await callUploadUrl();
  return callSubmit({
    credentialTypeId: credentialType.id,
    documentObjectKey: upload.body.objectKey,
  });
}

async function callReview(id: string, body: unknown): Promise<ApiResult> {
  const response = await postReview(
    await jsonRequest(`http://localhost/api/v1/credentials/${id}/review`, body),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

async function callDocumentUrl(id: string, body: unknown): Promise<ApiResult> {
  const response = await postDocumentUrl(
    await jsonRequest(`http://localhost/api/v1/credentials/${id}/document-url`, body),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

async function callResupply(id: string, body: unknown): Promise<ApiResult> {
  const response = await patchSubmission(
    new Request(`http://localhost/api/v1/credentials/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

async function loginAsPractitioner() {
  const user = await createUser();
  await grant({
    userId: user.id,
    roleKey: 'practitioner',
    permissions: ['credential.submit', 'credential.document.read'],
    scopeType: 'SELF',
    scopeId: user.id,
  });
  await issueSession({ userId: user.id });
  return user;
}

async function loginAsComplianceOfficer() {
  const user = await createUser();
  await grant({
    userId: user.id,
    roleKey: 'compliance_officer',
    permissions: ['credential.review', 'credential.document.read'],
    scopeType: 'PLATFORM',
  });
  await issueSession({ userId: user.id });
  return user;
}

async function loginAsDualRole() {
  const user = await createUser();
  await grant({
    userId: user.id,
    roleKey: 'practitioner',
    permissions: ['credential.submit', 'credential.document.read'],
    scopeType: 'SELF',
    scopeId: user.id,
  });
  await grant({
    userId: user.id,
    roleKey: 'compliance_officer',
    permissions: ['credential.review', 'credential.document.read'],
    scopeType: 'PLATFORM',
  });
  await issueSession({ userId: user.id });
  return user;
}

beforeEach(() => {
  clearCookies();
});

describe('a caller without a session', () => {
  it('is told to sign in on every action', async () => {
    expect((await callSubmit({})).status).toBe(401);
    expect((await callList({ scopeType: 'SELF' })).status).toBe(401);
    expect((await callUploadUrl()).status).toBe(401);
    expect((await callReview('00000000-0000-0000-0000-000000000000', {})).status).toBe(401);
    expect((await callDocumentUrl('00000000-0000-0000-0000-000000000000', {})).status).toBe(401);
  });
});

describe('a session with no grant', () => {
  it('is refused with 403 on every action', async () => {
    const user = await createUser();
    await issueSession({ userId: user.id });

    // Bodies must be well-formed here: handleGuardedRequest validates the
    // input before checking permission (401 → 422 → 403, already
    // established and tested in authorization.test.ts), so a malformed body
    // would 422 regardless of grants and never actually exercise this check.
    expect(
      (await callSubmit({ credentialTypeId: '00000000-0000-0000-0000-000000000000', referenceNumber: 'X' }))
        .status,
    ).toBe(403);
    expect((await callList({ scopeType: 'SELF' })).status).toBe(403);
    expect((await callUploadUrl()).status).toBe(403);
    expect(
      (await callReview('00000000-0000-0000-0000-000000000000', { decision: 'approve' })).status,
    ).toBe(403);
    expect(
      (await callDocumentUrl('00000000-0000-0000-0000-000000000000', { scopeType: 'SELF' })).status,
    ).toBe(403);
  });
});

describe('submitting a credential', () => {
  it('accepts a document_review type with an uploaded document', async () => {
    await loginAsPractitioner();
    const credentialType = await createCredentialType({ verificationMethod: 'document_review' });
    const upload = await callUploadUrl();

    const result = await callSubmit({
      credentialTypeId: credentialType.id,
      documentObjectKey: upload.body.objectKey,
    });

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ status: 'PENDING', documentObjectKey: upload.body.objectKey });
  });

  it('accepts a nimc_verification type with a reference number', async () => {
    await loginAsPractitioner();
    const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });

    const result = await callSubmit({
      credentialTypeId: credentialType.id,
      referenceNumber: 'A123456789',
    });

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ status: 'PENDING', referenceNumber: 'A123456789' });
  });

  it('rejects the wrong evidence for the verification method', async () => {
    await loginAsPractitioner();
    const documentType = await createCredentialType({ verificationMethod: 'document_review' });
    const referenceType = await createCredentialType({ verificationMethod: 'nimc_verification' });

    const wrongForDocument = await callSubmit({
      credentialTypeId: documentType.id,
      referenceNumber: 'A123456789',
    });
    expect(wrongForDocument.status).toBe(422);
    expect(wrongForDocument.body).toMatchObject({ error: { code: 'document_required' } });

    const upload = await callUploadUrl();
    const wrongForReference = await callSubmit({
      credentialTypeId: referenceType.id,
      documentObjectKey: upload.body.objectKey,
    });
    expect(wrongForReference.status).toBe(422);
    expect(wrongForReference.body).toMatchObject({ error: { code: 'reference_number_required' } });
  });

  it('refuses a duplicate active submission of the same type', async () => {
    await loginAsPractitioner();
    const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });

    const first = await callSubmit({ credentialTypeId: credentialType.id, referenceNumber: 'A1' });
    expect(first.status).toBe(201);

    const second = await callSubmit({ credentialTypeId: credentialType.id, referenceNumber: 'A2' });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: 'duplicate_active_submission' } });
  });

  it('allows resubmission after a rejection', async () => {
    const practitioner = await loginAsPractitioner();
    const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });
    const submitted = await callSubmit({ credentialTypeId: credentialType.id, referenceNumber: 'A1' });

    clearCookies();
    await loginAsComplianceOfficer();
    const rejected = await callReview(submitted.body.id as string, {
      decision: 'reject',
      reviewNotes: 'Reference number does not match records.',
    });
    expect(rejected.status).toBe(200);

    clearCookies();
    await issueSession({ userId: practitioner.id });
    const resubmitted = await callSubmit({ credentialTypeId: credentialType.id, referenceNumber: 'A1-corrected' });
    expect(resubmitted.status).toBe(201);
  });

  it('shows each caller only their own submissions at SELF scope', async () => {
    const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });

    const userA = await loginAsPractitioner();
    await callSubmit({ credentialTypeId: credentialType.id, referenceNumber: 'A1' });

    clearCookies();
    await loginAsPractitioner();
    await callSubmit({ credentialTypeId: credentialType.id, referenceNumber: 'B1' });

    clearCookies();
    await issueSession({ userId: userA.id });
    const list = await callList({ scopeType: 'SELF' });

    expect(list.status).toBe(200);
    const submissions = list.body.submissions as { userId: string }[];
    expect(submissions.length).toBeGreaterThan(0);
    expect(submissions.every((row) => row.userId === userA.id)).toBe(true);
  });
});

describe('reviewing a submission', () => {
  it('lets a compliance officer approve a different practitioner’s submission', async () => {
    const practitioner = await loginAsPractitioner();
    const submitted = await submitDocumentCredential({ expires: true, reviewDays: 30 });

    clearCookies();
    const officer = await loginAsComplianceOfficer();
    const result = await callReview(submitted.body.id as string, { decision: 'approve' });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'VERIFIED', reviewedBy: officer.id });
    expect(result.body.expiresAt).not.toBeNull();

    const events = await prisma.outboxEvent.findMany({
      where: { eventType: EVENTS.CredentialVerified, aggregateId: submitted.body.id as string },
    });
    expect(events).toHaveLength(1);

    // The practitioner sees the review in their own audit history.
    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'credential.verified', scopeId: practitioner.id },
    });
    expect(auditRows).toHaveLength(1);
  });

  it('requires reviewNotes to reject, and publishes no CredentialVerified event on rejection', async () => {
    await loginAsPractitioner();
    const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });
    const submitted = await callSubmit({ credentialTypeId: credentialType.id, referenceNumber: 'A1' });

    clearCookies();
    await loginAsComplianceOfficer();

    const withoutNotes = await callReview(submitted.body.id as string, { decision: 'reject' });
    expect(withoutNotes.status).toBe(422);

    const withNotes = await callReview(submitted.body.id as string, {
      decision: 'reject',
      reviewNotes: 'Document illegible.',
    });
    expect(withNotes.status).toBe(200);
    expect(withNotes.body).toMatchObject({ status: 'REJECTED' });

    const events = await prisma.outboxEvent.findMany({
      where: { eventType: EVENTS.CredentialVerified, aggregateId: submitted.body.id as string },
    });
    expect(events).toHaveLength(0);
  });

  it('treats a null body on a dynamic route as validation failure, not a crash', async () => {
    await loginAsPractitioner();
    const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });
    const submitted = await callSubmit({ credentialTypeId: credentialType.id, referenceNumber: 'A1' });

    clearCookies();
    await loginAsComplianceOfficer();
    const result = await callReview(submitted.body.id as string, null);

    expect(result.status).toBe(422);
  });

  it('refuses to review an already-reviewed submission', async () => {
    await loginAsPractitioner();
    const submitted = await submitDocumentCredential();

    clearCookies();
    await loginAsComplianceOfficer();
    await callReview(submitted.body.id as string, { decision: 'approve' });

    const second = await callReview(submitted.body.id as string, { decision: 'approve' });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: 'already_reviewed' } });
  });

  it('allows exactly one concurrent review of a pending submission', async () => {
    await loginAsPractitioner();
    const submitted = await submitDocumentCredential();

    clearCookies();
    await loginAsComplianceOfficer();
    const results = await Promise.all([
      callReview(submitted.body.id as string, { decision: 'approve' }),
      callReview(submitted.body.id as string, { decision: 'approve' }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);

    const events = await prisma.outboxEvent.findMany({
      where: { eventType: EVENTS.CredentialVerified, aggregateId: submitted.body.id as string },
    });
    expect(events).toHaveLength(1);
  });

  it('refuses a dual-role user reviewing their own submission', async () => {
    const dualRole = await loginAsDualRole();
    const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });
    const submitted = await callSubmit({ credentialTypeId: credentialType.id, referenceNumber: 'A1' });

    // Same session — holds both roles at once.
    const result = await callReview(submitted.body.id as string, { decision: 'approve' });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: 'cannot_review_own_submission' } });
    expect(dualRole.id).toBe(submitted.body.userId);
  });

  it('refuses a practitioner without credential.review, even reviewing someone else’s submission', async () => {
    await loginAsPractitioner();
    const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });
    const submitted = await callSubmit({ credentialTypeId: credentialType.id, referenceNumber: 'A1' });

    clearCookies();
    await loginAsPractitioner();
    const result = await callReview(submitted.body.id as string, { decision: 'approve' });
    expect(result.status).toBe(403);
  });
});

describe('document access', () => {
  it('lets the owner download their own document', async () => {
    await loginAsPractitioner();
    const credentialType = await createCredentialType({ verificationMethod: 'document_review' });
    const upload = await callUploadUrl();
    const submitted = await callSubmit({
      credentialTypeId: credentialType.id,
      documentObjectKey: upload.body.objectKey,
    });

    const result = await callDocumentUrl(submitted.body.id as string, { scopeType: 'SELF' });
    expect(result.status).toBe(200);
    expect(result.body.downloadUrl).toBeTruthy();

    const events = await prisma.securityEvent.findMany({
      where: { kind: 'credential.document_accessed' },
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it('404s a different practitioner requesting someone else’s document at SELF scope', async () => {
    await loginAsPractitioner();
    const credentialType = await createCredentialType({ verificationMethod: 'document_review' });
    const upload = await callUploadUrl();
    const submitted = await callSubmit({
      credentialTypeId: credentialType.id,
      documentObjectKey: upload.body.objectKey,
    });

    clearCookies();
    await loginAsPractitioner();
    const result = await callDocumentUrl(submitted.body.id as string, { scopeType: 'SELF' });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: 'submission_not_found' } });
  });

  it('lets a compliance officer at PLATFORM download anyone’s document', async () => {
    await loginAsPractitioner();
    const credentialType = await createCredentialType({ verificationMethod: 'document_review' });
    const upload = await callUploadUrl();
    const submitted = await callSubmit({
      credentialTypeId: credentialType.id,
      documentObjectKey: upload.body.objectKey,
    });

    clearCookies();
    await loginAsComplianceOfficer();
    const result = await callDocumentUrl(submitted.body.id as string, { scopeType: 'PLATFORM' });
    expect(result.status).toBe(200);
  });

  it('refuses a reference-number-only submission with no document', async () => {
    await loginAsPractitioner();
    const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });
    const submitted = await callSubmit({ credentialTypeId: credentialType.id, referenceNumber: 'A1' });

    const result = await callDocumentUrl(submitted.body.id as string, { scopeType: 'SELF' });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'no_document_on_submission' } });
  });
});

describe('step 5.7 — requesting more information', () => {
  async function pendingSubmission() {
    const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });
    const practitioner = await loginAsPractitioner();
    const submitted = await callSubmit({
      credentialTypeId: credentialType.id,
      referenceNumber: 'A11111111',
    });
    expect(submitted.status).toBe(201);
    return { practitioner, submissionId: submitted.body.id as string };
  }

  it('moves a submission to MORE_INFO_REQUESTED instead of deciding it', async () => {
    const { submissionId } = await pendingSubmission();
    await loginAsComplianceOfficer();

    const asked = await callReview(submissionId, {
      decision: 'request_info',
      reviewNotes: 'The reference number does not match the slip. Please re-check it.',
    });

    expect(asked.status).toBe(200);
    expect(asked.body.status).toBe('MORE_INFO_REQUESTED');
    // Not a decision: neither verified nor rejected, and no expiry computed.
    expect(asked.body.expiresAt).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'credential.info_requested', entityId: submissionId },
    });
    expect(audit?.reason).toContain('re-check');
  });

  it('refuses a request with no note saying what is missing', async () => {
    const { submissionId } = await pendingSubmission();
    await loginAsComplianceOfficer();

    // A request for more information that does not say what is missing is
    // worse than no request at all.
    expect((await callReview(submissionId, { decision: 'request_info' })).status).toBe(422);
  });

  it('lets the practitioner resupply, returning the row to PENDING', async () => {
    const { practitioner, submissionId } = await pendingSubmission();
    await loginAsComplianceOfficer();
    await callReview(submissionId, { decision: 'request_info', reviewNotes: 'Wrong number.' });

    await issueSession({ userId: practitioner.id });
    const resupplied = await callResupply(submissionId, { referenceNumber: 'B22222222' });

    expect(resupplied.status).toBe(200);
    expect(resupplied.body.status).toBe('PENDING');
    expect(resupplied.body.referenceNumber).toBe('B22222222');
    // The request has been answered, so the fields describing it are cleared;
    // what was asked survives on the audit row.
    expect(resupplied.body.reviewedBy).toBeNull();
    expect(resupplied.body.reviewNotes).toBeNull();
  });

  it('can then be approved, completing the round trip', async () => {
    // A document-reviewed credential, so "approved" is the officer's one click;
    // see submitDocumentCredential for why a NIN is not used here.
    const practitioner = await loginAsPractitioner();
    const submitted = await submitDocumentCredential();
    const submissionId = submitted.body.id as string;

    await loginAsComplianceOfficer();
    await callReview(submissionId, { decision: 'request_info', reviewNotes: 'Not legible.' });

    await issueSession({ userId: practitioner.id });
    const replacement = await callUploadUrl();
    await callResupply(submissionId, { documentObjectKey: replacement.body.objectKey });

    const officer = await loginAsComplianceOfficer();
    const approved = await callReview(submissionId, { decision: 'approve' });

    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('VERIFIED');
    expect(approved.body.reviewedBy).toBe(officer.id);
  });

  it('refuses a resupply on a submission that is not awaiting information', async () => {
    const { submissionId } = await pendingSubmission();

    const result = await callResupply(submissionId, { referenceNumber: 'C33333333' });

    // Not a general edit path: a reviewer must never be looking at one
    // version while the practitioner replaces it underneath them.
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: { code: 'not_awaiting_information' } });
  });

  it("refuses a resupply on someone else's submission, as a 404", async () => {
    const { submissionId } = await pendingSubmission();
    await loginAsComplianceOfficer();
    await callReview(submissionId, { decision: 'request_info', reviewNotes: 'Wrong number.' });

    await loginAsPractitioner();
    const result = await callResupply(submissionId, { referenceNumber: 'D44444444' });

    // 404 rather than 403: a distinguishable 403 would confirm that this
    // particular submission id exists.
    expect(result.status).toBe(404);
  });

  it('blocks a second submission while one is awaiting information', async () => {
    const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });
    const practitioner = await loginAsPractitioner();
    const first = await callSubmit({
      credentialTypeId: credentialType.id,
      referenceNumber: 'A11111111',
    });

    await loginAsComplianceOfficer();
    await callReview(first.body.id as string, {
      decision: 'request_info',
      reviewNotes: 'Wrong number.',
    });

    await issueSession({ userId: practitioner.id });
    const second = await callSubmit({
      credentialTypeId: credentialType.id,
      referenceNumber: 'B22222222',
    });

    // They should answer on the existing row, not open a second one the
    // reviewer then has to reconcile.
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: 'duplicate_active_submission' } });
  });
});

describe('the route table', () => {
  it('lists only the three credential permissions', () => {
    expect(ROUTES.length).toBeGreaterThan(0);
    const permissions = new Set(ROUTES.map((route) => route.permission));
    expect(permissions).toEqual(
      new Set(['credential.submit', 'credential.review', 'credential.document.read']),
    );
  });

  it('offers both SELF and PLATFORM for list and document-url, PLATFORM only for review', () => {
    const listScopes = ROUTES.filter((r) => r.path === '/api/v1/credentials' && r.method === 'GET').map(
      (r) => r.scopeType,
    );
    expect(new Set(listScopes)).toEqual(new Set(['SELF', 'PLATFORM']));

    const documentUrlScopes = ROUTES.filter((r) => r.path.endsWith('/document-url')).map(
      (r) => r.scopeType,
    );
    expect(new Set(documentUrlScopes)).toEqual(new Set(['SELF', 'PLATFORM']));

    const reviewScopes = ROUTES.filter((r) => r.path.endsWith('/review')).map((r) => r.scopeType);
    expect(new Set(reviewScopes)).toEqual(new Set(['PLATFORM']));
  });
});
