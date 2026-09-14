import { describe, expect, it } from 'vitest';
import { env } from '../env';
import {
  assertUploadAllowed,
  buildObjectKey,
  createDownloadUrl,
  createUploadUrl,
  MAX_UPLOAD_BYTES,
} from './tigris';

describe('object storage rules', () => {
  it('rejects content types outside the allow list', () => {
    expect(() => assertUploadAllowed('application/zip', 1024)).toThrow();
    expect(() => assertUploadAllowed('application/pdf', 1024)).not.toThrow();
  });

  it('rejects empty and oversized files', () => {
    expect(() => assertUploadAllowed('image/jpeg', 0)).toThrow();
    expect(() => assertUploadAllowed('image/jpeg', MAX_UPLOAD_BYTES + 1)).toThrow();
  });

  it('builds an unguessable, purpose-prefixed key', () => {
    const owner = '11111111-1111-1111-1111-111111111111';
    const key = buildObjectKey('credential_document', owner, 'licence.PDF');
    expect(key.startsWith('credential_document/')).toBe(true);
    expect(key.includes(owner)).toBe(true);
    expect(key.endsWith('.pdf')).toBe(true);
    expect(key).not.toContain('licence');
  });
});

/**
 * A signed URL is handed to a browser, so it has to name a host the browser
 * can resolve. Under Docker the app reaches storage at `storage:9000`, which
 * exists only on the compose network — signing against it produced URLs that
 * were perfectly valid and impossible to open, and that silently broke every
 * upload flow in the product. Nothing failed loudly, so nothing caught it.
 */
describe('signed URLs are addressed to the browser, not to this process', () => {
  const publicOrigin = new URL(env.STORAGE_PUBLIC_ENDPOINT ?? env.STORAGE_ENDPOINT).origin;

  it('builds an upload URL against the public endpoint', async () => {
    const { url } = await createUploadUrl({
      purpose: 'profile_photograph',
      ownerId: '11111111-1111-1111-1111-111111111111',
      filename: 'face.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
    });

    expect(new URL(url).origin).toBe(publicOrigin);
    expect(url).toContain('X-Amz-Signature');
  });

  it('builds a download URL against the same public endpoint', async () => {
    const url = await createDownloadUrl('profile_photograph/202609/owner/abc.jpg');

    expect(new URL(url).origin).toBe(publicOrigin);
    expect(url).toContain('X-Amz-Signature');
  });
});
