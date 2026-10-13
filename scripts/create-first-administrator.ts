/**
 * Creates the first super administrator on a database that has none.
 *
 *   pnpm tsx scripts/create-first-administrator.ts \
 *     --phone 08031234567 --name "Hadiza Lawal" --email hadiza@example.org
 *
 * Unlike the demo scripts this is meant for production, which is why it works
 * the way it does: it asks for the password at the terminal, without echoing
 * it, rather than taking one on the command line where `ps` and a shell
 * history would keep it. For a pipeline, `FIRST_ADMIN_PASSWORD` is read
 * instead. The password is never printed.
 *
 * It refuses when a super administrator already exists. `--additional` is the
 * deliberate exception, for the day every one of them has lost access, and the
 * audit record says it was used. See createFirstAdministrator for the rest of
 * what it will and will not do.
 *
 * In the production image, which has no pnpm:
 *   node_modules/.bin/tsx scripts/create-first-administrator.ts --phone ... --name ...
 */
import { userInfo } from 'node:os';
import { createInterface } from 'node:readline';
import { prisma } from '../src/lib/db';
import { createFirstAdministrator } from '../src/modules/auth/application/first-administrator';
import { PASSWORD_MIN_LENGTH } from '../src/lib/password-policy';

function parseArguments(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (!flag.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`);
    const name = flag.slice(2);
    if (name === 'additional') {
      parsed[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
    parsed[name] = value;
    index += 1;
  }
  return parsed;
}

/** Reads one line from the terminal with what is typed not shown. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error('No terminal to ask for a password on. Set FIRST_ADMIN_PASSWORD instead.'),
      );
      return;
    }
    const reader = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = reader as unknown as { _writeToOutput: (text: string) => void };
    let asked = false;
    output._writeToOutput = (text: string) => {
      // Let the question itself through, and nothing typed after it.
      if (!asked) {
        process.stdout.write(text);
        asked = true;
      }
    };
    reader.question(question, (answer) => {
      reader.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPassword(): Promise<string> {
  const fromEnvironment = process.env.FIRST_ADMIN_PASSWORD;
  if (fromEnvironment) return fromEnvironment;

  const first = await promptHidden(`Password (at least ${PASSWORD_MIN_LENGTH} characters): `);
  const second = await promptHidden('Again: ');
  if (first !== second) throw new Error('The two passwords did not match. Nothing was created.');
  return first;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const phone = args.phone;
  const name = args.name;
  if (typeof phone !== 'string' || typeof name !== 'string') {
    throw new Error('Usage: --phone <number> --name "<full name>" [--email <address>] [--additional]');
  }

  const result = await createFirstAdministrator({
    phone,
    fullName: name,
    email: typeof args.email === 'string' ? args.email : undefined,
    password: await readPassword(),
    operator: process.env.USER ?? userInfo().username,
    additional: args.additional === true,
  });

  console.log(`Created a super administrator for ${result.phone}.`);
  console.log('They can sign in at /login with that number and the password just set.');
  console.log('From there, appoint everybody else in the console; this command is not needed again.');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
