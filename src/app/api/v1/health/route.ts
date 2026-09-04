import { prisma } from '@/lib/db';
import { contextLogger, requestContextFrom } from '@/lib/http/request-context';
import { fail, ok } from '@/lib/http/responses';

/**
 * Liveness and readiness in one place. The pipeline and the container
 * healthcheck both call this, so it must check real dependencies rather than
 * returning a static 200.
 */
export async function GET(request: Request) {
  const context = requestContextFrom(request);
  const log = contextLogger(context);

  const checks: Record<string, 'ok' | 'failed'> = { database: 'failed' };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch (error) {
    log.error('health check: database unreachable', { error: String(error) });
  }

  const healthy = Object.values(checks).every((value) => value === 'ok');
  const body = { status: healthy ? 'ok' : 'degraded', checks, time: new Date().toISOString() };

  return healthy ? ok(body, context) : fail('unhealthy', 'A dependency is unavailable.', context, 503, body);
}
