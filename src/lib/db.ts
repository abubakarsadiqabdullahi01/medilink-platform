import { PrismaClient } from '@prisma/client';

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

/** A transaction client: the type every audited write accepts. */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
