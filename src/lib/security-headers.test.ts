import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from './security-headers.mjs';

const directive = (policy: string, name: string) =>
  policy
    .split('; ')
    .find((part) => part.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(' ');

describe('contentSecurityPolicy', () => {
  const production = contentSecurityPolicy({
    storageEndpoints: ['https://fly.storage.tigris.dev', undefined],
  });

  it('refuses framing, plugins and a redirected base or form', () => {
    expect(directive(production, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(production, 'object-src')).toEqual(["'none'"]);
    expect(directive(production, 'base-uri')).toEqual(["'self'"]);
    expect(directive(production, 'form-action')).toEqual(["'self'"]);
  });

  it('loads nothing from an origin but this one and the object store', () => {
    expect(directive(production, 'default-src')).toEqual(["'self'"]);
    for (const name of ['script-src', 'style-src', 'font-src', 'media-src']) {
      for (const source of directive(production, name) ?? []) {
        expect(source).not.toMatch(/^https?:/);
      }
    }
  });

  it("lets pages talk to the object store they upload to and read from, and subdomains of a hosted one", () => {
    expect(directive(production, 'connect-src')).toEqual(
      expect.arrayContaining(["'self'", 'https://fly.storage.tigris.dev', 'https://*.fly.storage.tigris.dev']),
    );
    expect(directive(production, 'img-src')).toContain('https://fly.storage.tigris.dev');
  });

  it('does not open subdomains of a plain-http store such as the one on a laptop', () => {
    const local = contentSecurityPolicy({ storageEndpoints: ['http://localhost:9000'] });
    expect(directive(local, 'connect-src')).toContain('http://localhost:9000');
    expect(local).not.toContain('*.');
  });

  it('ignores a storage setting that is not a URL', () => {
    expect(() => contentSecurityPolicy({ storageEndpoints: ['not a url', ''] })).not.toThrow();
  });

  it('allows evaluation and the hot-reload socket in development only', () => {
    const dev = contentSecurityPolicy({ development: true });
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(dev, 'connect-src')).toContain('ws:');
    expect(directive(production, 'script-src')).not.toContain("'unsafe-eval'");
    expect(directive(production, 'connect-src')).not.toContain('ws:');
  });
});

describe('securityHeaders', () => {
  const headers = securityHeaders({ NODE_ENV: 'production', STORAGE_ENDPOINT: 'https://s3.example.org' });
  const byKey = Object.fromEntries(headers.map((header) => [header.key, header.value]));

  it('keeps the four it already sent', () => {
    expect(byKey['X-Content-Type-Options']).toBe('nosniff');
    expect(byKey['X-Frame-Options']).toBe('DENY');
    expect(byKey['Referrer-Policy']).toBeDefined();
    expect(byKey['Permissions-Policy']).toBeDefined();
  });

  it('adds transport security and a content security policy', () => {
    expect(byKey['Strict-Transport-Security']).toMatch(/^max-age=\d+$/);
    // Not the one-way commitments.
    expect(byKey['Strict-Transport-Security']).not.toMatch(/includeSubDomains|preload/);
    expect(byKey['Content-Security-Policy']).toContain("default-src 'self'");
  });

  it('builds the policy from the environment it is given', () => {
    expect(byKey['Content-Security-Policy']).toContain('https://s3.example.org');
  });
});
