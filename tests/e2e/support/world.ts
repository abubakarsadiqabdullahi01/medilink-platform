import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The starting point `scripts/e2e-world.ts` built for this run.
 *
 * Read from disk rather than passed through Playwright's config because global
 * setup and the test workers are separate processes; the file is the only
 * thing both can see.
 */
export interface Person {
  id: string;
  fullName: string;
  phone: string;
}

export interface World {
  builtAt: string;
  password: string;
  admin: Person;
  owner: Person;
  scheduler: Person;
  pendingOwner: Person;
  practitioner: Person;
  newcomer: Person;
  facility: { id: string; name: string };
  pendingFacility: { id: string; name: string };
  afterShift: { assignmentId: string; startsAt: string; endsAt: string; hourlyRateKobo: number };
  liveShift: { assignmentId: string; startsAt: string; endsAt: string };
  workerLagSeconds: number;
}

export const WORLD_FILE = join(process.cwd(), '.e2e', 'world.json');

let cached: World | null = null;

export function world(): World {
  cached ??= JSON.parse(readFileSync(WORLD_FILE, 'utf8')) as World;
  return cached;
}
