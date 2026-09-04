import { describe, expect, it } from 'vitest';
import { assertUploadAllowed, buildObjectKey, MAX_UPLOAD_BYTES } from './tigris';

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
