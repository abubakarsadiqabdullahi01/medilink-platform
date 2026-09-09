import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { env } from '../env';

/**
 * Object storage: Tigris in staging and production, MinIO locally. Both are
 * S3-compatible, so this is the only file that knows the difference.
 *
 * Rules:
 *   * the bucket is private; every read and write goes through a signed,
 *     short-lived URL
 *   * PostgreSQL stores the key and metadata only, never the bytes
 *   * keys are opaque and unguessable, so a leaked key reveals nothing
 */
export const s3 = new S3Client({
  region: env.STORAGE_REGION,
  endpoint: env.STORAGE_ENDPOINT,
  forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
  },
});

export type ObjectPurpose =
  | 'credential_document'
  | 'facility_licence'
  | 'profile_photograph'
  | 'dispute_evidence'
  | 'incident_attachment'
  | 'timesheet_attachment';

export const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
]);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function buildObjectKey(purpose: ObjectPurpose, ownerId: string, filename: string): string {
  const extension = filename.includes('.') ? filename.split('.').pop()!.toLowerCase().slice(0, 8) : 'bin';
  const now = new Date();
  const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${purpose}/${yyyymm}/${ownerId}/${randomUUID()}.${extension}`;
}

export function assertUploadAllowed(contentType: string, sizeBytes: number): void {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }
  if (sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error(`File size out of range: ${sizeBytes} bytes`);
  }
}

/** Signed PUT URL handed to the client so bytes never pass through the app. */
export async function createUploadUrl(input: {
  purpose: ObjectPurpose;
  ownerId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<{ objectKey: string; url: string; expiresInSeconds: number }> {
  assertUploadAllowed(input.contentType, input.sizeBytes);
  const objectKey = buildObjectKey(input.purpose, input.ownerId, input.filename);

  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
    }),
    { expiresIn: env.STORAGE_SIGNED_URL_TTL_SECONDS },
  );

  return { objectKey, url, expiresInSeconds: env.STORAGE_SIGNED_URL_TTL_SECONDS };
}

/** Signed GET URL. Callers must authorise the request before calling this. */
export async function createDownloadUrl(objectKey: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: objectKey }),
    { expiresIn: env.STORAGE_SIGNED_URL_TTL_SECONDS },
  );
}

/** Confirms the client actually completed the upload before we trust the row. */
export async function headObject(objectKey: string) {
  return s3.send(new HeadObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: objectKey }));
}
