import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { contextLogger, requestContextFrom } from '@/lib/http/request-context';
import { fail, ok } from '@/lib/http/responses';
import { parseAfricasTalkingReceipt } from '@/lib/sms/receipts';
import { recordDeliveryReceipt } from '@/modules/notifications/application/receipts';

/**
 * POST /api/v1/webhooks/sms/africastalking — Africa's Talking's delivery report for a message
 * it took (M16-05).
 *
 * Called by the gateway, not a person, so there is no session. It exists only when
 * `SMS_RECEIPT_SECRET` is set (404 otherwise, so a deployment that has not chosen it exposes
 * nothing) and answers only a caller who puts that secret in the URL as `?token=`, because the
 * provider does not sign its callbacks. A secret in a URL can end up in an access log: change
 * `SMS_RECEIPT_SECRET` and the callback address together if it does.
 *
 * What it can do is narrow on purpose: set the delivery state of a message this system itself
 * gave that gateway, forward only. It reads no record and returns none. A report it cannot read
 * is a 400; one for a message it does not know is a 200, so the gateway does not retry it for
 * ever.
 */
function sameSecret(given: string, secret: string): boolean {
  // Equal-length digests, so neither the comparison nor the length reveals where they differ.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

export async function POST(request: Request) {
  const context = requestContextFrom(request);
  const log = contextLogger(context);

  const secret = env.SMS_RECEIPT_SECRET;
  if (!secret) return fail('not_found', 'Not found.', context, 404);

  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!token || !sameSecret(token, secret)) {
    return fail('unauthorized', 'Not authorised.', context, 401);
  }

  let fields: Record<string, string>;
  try {
    const form = await request.formData();
    fields = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === 'string')) as Record<string, string>;
  } catch {
    return fail('unreadable', 'The report could not be read.', context, 400);
  }

  const receipt = parseAfricasTalkingReceipt(fields);
  if (!receipt) {
    // The field names only, never their values: a report carries a phone number.
    log.warn('an Africa\'s Talking delivery report could not be read', { fields: Object.keys(fields).sort() });
    return fail('unreadable', 'The report could not be read.', context, 400);
  }

  const result = await recordDeliveryReceipt(receipt);
  log.info('delivery report recorded', {
    provider: receipt.provider,
    outcome: receipt.outcome,
    matched: result.matched,
  });
  return ok({ received: true }, context);
}
