import { afterAll, afterEach, beforeEach, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { installAuditCoverage } from '@/lib/audit-coverage';
import { smsProblems } from '@/modules/notifications/domain/sms-hygiene';
import { resetDatabase } from './support/db';

/**
 * The audit observer is installed for the whole run but records nothing until
 * a test opens a window with startAuditCoverage(), so files that do not care
 * about audit coverage pay no attention cost.
 */
installAuditCoverage(prisma);

beforeEach(async () => {
  await resetDatabase();
});

/**
 * Every text any test caused to be stored is held to the rules a text must keep (M16-07): the GSM
 * character set, at most three segments, a time that says WAT, no number somebody could dial or
 * pay into. The fixtures are ordinary, so a template that breaks one is the template's fault. The
 * database is read before the next test's reset empties it.
 */
afterEach(async () => {
  const messages = await prisma.notificationMessage.findMany({ select: { kind: true, body: true } });
  const faults = messages.flatMap((message) =>
    smsProblems(message.body).map((problem) => `${message.kind}: ${problem}\n    "${message.body}"`),
  );
  expect(faults, 'a stored text breaks the rules in sms-hygiene.ts').toEqual([]);
});

afterAll(async () => {
  await prisma.$disconnect();
});
