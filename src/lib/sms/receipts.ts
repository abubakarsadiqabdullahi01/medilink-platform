/**
 * Reading what a gateway says, after the fact, about a message it took.
 *
 * Provider-neutral outcome, so the rest of the system never learns a gateway's vocabulary:
 * `PENDING` (the gateway has it and is passing it on), `DELIVERED`, `FAILED`.
 *
 * A parser reads only what it recognises and returns `null` for everything else. A report it
 * cannot read changes nothing; it never guesses. Neither the recipient's number nor the network
 * is carried out of here: the message id is how a report finds its message, and the number is
 * somebody's.
 */
export type ReceiptOutcome = 'PENDING' | 'DELIVERED' | 'FAILED';

export interface ParsedReceipt {
  provider: string;
  providerMessageId: string;
  outcome: ReceiptOutcome;
  /** A reason code the gateway gave, short enough to store; never anything about the person. */
  detail: string | null;
}

const DETAIL_MAX_LENGTH = 100;

/**
 * Africa's Talking's delivery report: form-encoded `id`, `status`, `failureReason` (and
 * `phoneNumber`, `networkCode`, `retryCount`, which are not read).
 *
 * **Written from what the provider documents, not seen from the provider**: there is no
 * account here to receive one, and the documentation could not be reached when this was
 * written. If its field names or status words differ, no report will match and every message
 * stays "no report", which is where it started; nothing is marked delivered by mistake.
 */
const AFRICAS_TALKING_STATUS: Record<string, ReceiptOutcome> = {
  success: 'DELIVERED',
  sent: 'PENDING',
  submitted: 'PENDING',
  buffered: 'PENDING',
  failed: 'FAILED',
  rejected: 'FAILED',
};

export function parseAfricasTalkingReceipt(fields: Record<string, string | undefined>): ParsedReceipt | null {
  const providerMessageId = fields.id?.trim();
  const outcome = AFRICAS_TALKING_STATUS[fields.status?.trim().toLowerCase() ?? ''];
  if (!providerMessageId || !outcome) return null;

  const reason = fields.failureReason?.trim();
  return {
    provider: 'africastalking',
    providerMessageId,
    outcome,
    detail: reason ? reason.slice(0, DETAIL_MAX_LENGTH) : null,
  };
}
