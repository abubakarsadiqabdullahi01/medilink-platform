import { contextLogger, requestContextFrom } from '@/lib/http/request-context';
import { fail, ok } from '@/lib/http/responses';
import { systemStatus } from '@/modules/audit-compliance/application/system-status';

/**
 * GET /api/v1/health/background — for an uptime monitor: is the background work
 * getting done?
 *
 * Apart from /api/v1/health on purpose. That one is the container's liveness
 * check, and a stopped worker is no reason to restart the web server. This one
 * answers 503 when the worker is behind or not running or an event has given
 * up, so a monitor pointed at it pages somebody.
 *
 * Open to anybody, so it says what is wrong by name and nothing else: no counts,
 * no event types, no error text.
 */
export async function GET(request: Request) {
  const context = requestContextFrom(request);
  const log = contextLogger(context);

  try {
    const status = await systemStatus();
    const body = {
      status: status.status,
      problems: status.problems.map((problem) => problem.key),
      time: new Date().toISOString(),
    };
    return status.status === 'ok'
      ? ok(body, context)
      : fail('background_degraded', 'Background work is not getting done.', context, 503, body);
  } catch (error) {
    log.error('background health check failed', { error: String(error) });
    return fail('unhealthy', 'The check could not be made.', context, 503, {
      status: 'degraded',
      problems: ['check_failed'],
    });
  }
}
