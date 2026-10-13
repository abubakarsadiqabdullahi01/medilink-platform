import { PrismaClient, type Prisma } from '@prisma/client';
import { recordQuery } from '@/lib/http/timing';

/**
 * One Prisma client per process. Next.js hot reload would otherwise open a
 * new pool on every edit and exhaust PostgreSQL connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Times every query and adds it to the request that made it (a no-op in the
// worker and in scripts, where there is no request). A middleware rather than a
// client extension, because an extension changes the client's type and with it
// the `Tx` type every audited write is declared against. Registered once per
// process: hot reload re-evaluates this module but keeps the client.
const instrumented = globalThis as unknown as { prismaTiming?: boolean };
if (!instrumented.prismaTiming) {
  instrumented.prismaTiming = true;
  prisma.$use(async (params, next) => {
    const started = performance.now();
    try {
      return await next(params);
    } finally {
      recordQuery(performance.now() - started);
    }
  });
}

/** A transaction client: the type every audited write accepts. */
export type Tx = Prisma.TransactionClient;
