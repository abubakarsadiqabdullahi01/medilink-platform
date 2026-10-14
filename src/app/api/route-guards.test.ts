// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AUT-10 / QAL-01, the half that can be checked by reading: every API route is
 * written through a wrapper that resolves the caller before it does anything, or
 * is on a short list of routes that do so by hand, with the reason.
 *
 * It cannot show that a route is *correct* (the cross-tenant suite in
 * tests/integration does that for the routes that take an id); it shows that no
 * route can be added that reaches data with no caller check at all, and that
 * nothing joins the exceptions unnoticed.
 */

const ROOT = join(__dirname, '../../..');
const API = join(ROOT, 'src/app/api');

/** Written to resolve the caller and decide what they may see, with a wrapper of their own. */
const APPROVED_WRAPPERS = ['handleGuardedRequest', 'handleSessionRequest', 'handleAuthRequest'];

/**
 * Routes that do not use a wrapper, and why that is safe. Adding one is a decision
 * somebody reads.
 */
const HAND_WRITTEN: Record<string, string> = {
  'v1/auth/step-up/route.ts':
    'Confirms the signed-in caller\'s own password to refresh their own session; it needs a session and holds no data.',
  'v1/reference/route.ts':
    'Authenticated, not permission-guarded: the controlled vocabularies are nobody\'s records and every form needs them.',
  'v1/dashboard/platform/route.ts':
    'Asks the guard itself, per section, at PLATFORM scope; holding none of them is 403, never an empty page.',
  'v1/health/route.ts': 'Public: reports only that the process is up, for the load balancer.',
  'v1/health/background/route.ts':
    'Public: says whether background work is healthy and names no record, for an uptime monitor.',
  'v1/auth/session/route.ts': 'Says who the caller is and what they may do; anonymous gets 401.',
  'v1/auth/logout/route.ts': 'Ends the caller\'s own session, and is idempotent for a stale cookie.',
  'v1/dashboard/facility/route.ts':
    'Asks the guard itself, per section, at the facility named; a facility the caller holds nothing at is 403.',
  'v1/dashboard/practitioner/route.ts':
    'Asks the guard itself, per section, for the caller\'s own record; holding none of them is 403.',
  'v1/facilities/register/route.ts':
    'Authenticated but not permission-guarded: a hospital that has never used Medilink holds no grant; it is created PENDING and cannot publish until verified.',
};

/** The code without its comments: a wrapper named in a comment is not one that is used. */
function code(file: string): string {
  return readFileSync(join(API, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function routeFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'route.ts') found.push(relative(API, full).split('\\').join('/'));
    }
  };
  walk(API);
  return found.sort();
}


describe('every API route', () => {
  const files = routeFiles();

  it('finds the routes (a guard on the parser)', () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it('is written through a wrapper that resolves the caller, or is a listed exception', () => {
    const unguarded = files.filter((file) => {
      const wrapped = APPROVED_WRAPPERS.some((wrapper) => code(file).includes(`${wrapper}(`));
      return !wrapped && !(file in HAND_WRITTEN);
    });

    expect(unguarded).toEqual([]);
  });

  it('keeps the exceptions honest: each still exists and still has no wrapper', () => {
    for (const file of Object.keys(HAND_WRITTEN)) {
      expect(files, file).toContain(file);
      // An exception that has since adopted a wrapper should leave the list.
      expect(APPROVED_WRAPPERS.some((wrapper) => code(file).includes(`${wrapper}(`)), file).toBe(false);
    }
  });

  it('that is hand-written still asks who the caller is, unless it is public', () => {
    const PUBLIC = ['v1/health/route.ts', 'v1/health/background/route.ts'];
    for (const file of Object.keys(HAND_WRITTEN).filter((name) => !PUBLIC.includes(name))) {
      expect(/requireSession|currentSession|sessionState/.test(code(file)), file).toBe(true);
    }
  });

  it('names a permission and a scope wherever it uses the guarded wrapper', () => {
    for (const file of files) {
      const source = code(file);
      if (!source.includes('handleGuardedRequest(')) continue;
      expect(source, file).toMatch(/permission:\s*'[a-z_.]+'/);
      expect(source, file).toMatch(/scope:/);
    }
  });
});
