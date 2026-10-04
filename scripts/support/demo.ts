/**
 * What `bootstrap-demo.ts` and `seed-demo.ts` both need.
 *
 * The two scripts build deliberately separate worlds — the bootstrap makes
 * the handful of actors `scripts/e2e.py` drives and prints their ids as JSON;
 * seed-demo builds a pilot's worth of history for a person to click through.
 * That separation is worth keeping (see docs/end-to-end.md), and merging them
 * into one script would mean the end-to-end run waiting on three thousand
 * lines of seeded history it never looks at.
 *
 * What was not worth keeping is three copies of the same scaffolding. The
 * password was declared twice, the role sync three times, and each copy had
 * drifted: both scripts reset role names to their slugs and neither removed a
 * permission that had left a bundle, so running a script after the seed left
 * the database more permissive than the code said it should be.
 */
import { hashPassword } from '../../src/lib/password';

/** Every demo account shares it. This is not a secret and is not meant to be. */
export const DEMO_PASSWORD = 'Medilink-demo-2026';

export { syncRoles } from '../../src/lib/authz/sync-roles';

/**
 * Refuses to run anywhere but a developer's own machine.
 *
 * Both scripts create administrators with a password printed to the terminal.
 * The check is here so neither can forget it, and so adding a third script
 * inherits the refusal rather than reinventing it.
 */
export function assertLocal(scriptName: string): void {
  const env = process.env.APP_ENV ?? 'local';
  if (env !== 'local') {
    throw new Error(
      `${scriptName} refuses to run with APP_ENV=${env}. It creates administrators with a known password.`,
    );
  }
}

/**
 * Argon2id is deliberately slow and every demo account shares one password,
 * so the hash is computed once per process rather than sixty times.
 */
let cached: string | null = null;

export async function demoPasswordHash(): Promise<string> {
  cached ??= await hashPassword(DEMO_PASSWORD);
  return cached;
}
