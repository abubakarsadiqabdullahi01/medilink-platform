export function contentSecurityPolicy(options?: {
  storageEndpoints?: (string | undefined)[];
  development?: boolean;
}): string;

export const STRICT_TRANSPORT_SECURITY: string;

export function securityHeaders(
  env?: Record<string, string | undefined>,
): { key: string; value: string }[];
