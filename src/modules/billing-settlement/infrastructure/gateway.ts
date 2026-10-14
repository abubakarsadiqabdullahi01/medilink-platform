import { env } from '@/lib/env';

/**
 * The payment gateway, stubbed.
 *
 * Step 3.3 — authorise-then-capture confirmed with a provider — is not
 * settled, so there is no real adapter to write yet and guessing at one would
 * mean rewriting it. This follows the same shape the SMS adapter already
 * uses: a named provider, a console implementation for local work, and a real
 * one that throws until it is written.
 *
 * The important part is that the call site does not change when the provider
 * arrives. Everything above this file already treats a payout as something
 * that is *requested* and later *confirmed*, which is what
 * authorise-then-capture needs.
 */

export interface PayoutRequest {
  payoutId: string;
  practitionerId: string;
  amountKobo: number;
}

export interface PayoutResult {
  /** The provider's own reference, once it has one. Null when finance will supply the bank's. */
  reference: string | null;
  /** Settled immediately, or accepted and confirmed later by webhook. */
  settled: boolean;
}

export class PaymentGatewayUnavailable extends Error {
  constructor(provider: string) {
    super(
      `No payment gateway is configured (PAYMENT_PROVIDER=${provider}). Step 3.3 has not been settled; set PAYMENT_PROVIDER=manual to pay by bank transfer and record it here.`,
    );
    this.name = 'PaymentGatewayUnavailable';
  }
}

/**
 * Local only, and it says so in the reference.
 *
 * A stub that returned a plausible-looking bank reference would be a stub
 * somebody eventually mistakes for a real payment.
 */
async function consoleGateway(request: PayoutRequest): Promise<PayoutResult> {
  const reference = `stub-${request.payoutId.slice(0, 8)}`;
  // eslint-disable-next-line no-console
  console.info(
    `[payments] STUB — no money moved. payout=${request.payoutId} amount=${request.amountKobo} kobo`,
  );
  return { reference, settled: true };
}

/**
 * Whether people, rather than a provider, make the bank transfer.
 *
 * Recording a transfer by hand completes a payout, so it is only allowed while
 * that is how payouts are paid: with a gateway configured, the gateway says what
 * became of a payout, and a person recording a second transfer against it would
 * pay the practitioner twice.
 */
export function paidByHand(): boolean {
  return env.PAYMENT_PROVIDER === 'manual';
}

export async function sendPayout(request: PayoutRequest): Promise<PayoutResult> {
  const provider = env.PAYMENT_PROVIDER ?? 'none';

  if (provider === 'manual') {
    // Nothing is sent anywhere. The payout is released, which is the decision to
    // pay, and finance make the transfer and record it (BIL-05).
    return { reference: null, settled: false };
  }

  if (provider === 'console') {
    if (env.APP_ENV !== 'local') {
      // The same guard the SMS stub carries: a console provider outside local
      // means somebody deployed with the wrong configuration, and silently
      // "succeeding" would report money as paid that never moved.
      throw new PaymentGatewayUnavailable(provider);
    }
    return consoleGateway(request);
  }

  throw new PaymentGatewayUnavailable(provider);
}
