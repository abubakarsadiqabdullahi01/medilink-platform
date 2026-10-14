/**
 * The response headers every page and API answer carries.
 *
 * A plain .mjs file because next.config.mjs has to import it and cannot import
 * TypeScript; the types are in security-headers.d.ts and the rules are tested in
 * security-headers.test.ts.
 *
 * The Content-Security-Policy is deliberately a *restricting* one rather than
 * the strictest possible. Next injects inline scripts to hydrate a page, and a
 * nonce-based policy needs a middleware that rewrites every response, so
 * script-src allows 'unsafe-inline'. What it still does is the part that does
 * not depend on that: nothing loads from any origin but this one and the
 * object store, the page cannot be framed, `<base>` and form targets cannot be
 * redirected, and plugins are off. Tightening script-src to nonces is the next
 * step and is worth its own change, because it is the one that can break pages.
 */

/** The origin of an object-store URL, or null if it is not one. */
function originOf(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Signed upload and download URLs point at the object store, which is not this
 * origin. A hosted store may answer on a sibling host (a bucket subdomain), so
 * an https store is allowed with its subdomains too.
 */
function storageSources(storageEndpoints) {
  const sources = new Set();
  for (const endpoint of storageEndpoints) {
    const origin = originOf(endpoint);
    if (!origin) continue;
    sources.add(origin);
    const { protocol, host } = new URL(origin);
    if (protocol === 'https:') sources.add(`https://*.${host}`);
  }
  return [...sources];
}

export function contentSecurityPolicy({ storageEndpoints = [], development = false } = {}) {
  const storage = storageSources(storageEndpoints);

  const directives = {
    'default-src': ["'self'"],
    // React's dev tooling evaluates code; a production build does not.
    'script-src': ["'self'", "'unsafe-inline'", ...(development ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...storage],
    'font-src': ["'self'", 'data:'],
    // The hot-reload socket, in development only.
    'connect-src': ["'self'", ...storage, ...(development ? ['ws:', 'wss:'] : [])],
    'media-src': ["'self'", 'blob:'],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  };

  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/**
 * HSTS without includeSubDomains or preload: those commit every subdomain, now
 * and later, to https for a year, and they are one-way. A browser ignores the
 * header over plain http, so it is harmless on a developer's machine.
 */
export const STRICT_TRANSPORT_SECURITY = 'max-age=31536000';

export function securityHeaders(env = process.env) {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
    { key: 'Strict-Transport-Security', value: STRICT_TRANSPORT_SECURITY },
    {
      key: 'Content-Security-Policy',
      value: contentSecurityPolicy({
        storageEndpoints: [env.STORAGE_PUBLIC_ENDPOINT, env.STORAGE_ENDPOINT],
        development: env.NODE_ENV !== 'production',
      }),
    },
  ];
}
