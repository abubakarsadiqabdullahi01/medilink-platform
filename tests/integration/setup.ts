import { afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { installAuditCoverage } from '@/lib/audit-coverage';
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

afterAll(async () => {
  await prisma.$disconnect();
});
