import { isNigerianPhone } from '@/lib/phone';
import { smsEncoding } from '@/lib/sms-text';

/**
 * What a text message must not be, whatever it is about (M16-07, NOT-05). Pure, no database.
 *
 * The rules are about the text, not the template that wrote it, so the integration tests can hold
 * every message the platform sends to them. A text goes to a phone, is read on a lock screen and
 * is kept by a carrier; what it names is chosen with that in mind (`notification-matrix.ts` says
 * what each may name), and these are the mistakes that choice can still be undone by: a character
 * that doubles the price, a time that is an hour out, a number that is somebody's account.
 */

/** A text of more than this is something to read in the app, so it says less and points there. */
export const MAX_SEGMENTS = 3;

/** A bank account is ten digits, a NIN or a BVN eleven, a phone number eleven. No text needs nine in a row. */
const LONG_DIGITS = /\d{9,}/;

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Anything that looks like a run of digits and the separators people put between them. */
const NUMBER_SHAPED = /\+?\(?\d[\d\s().-]{7,}\d/g;

const CLOCK = /\b\d{1,2}:\d{2}\b/g;

/** "2026-10-15T07:00" and "2026-10-15 07:00:00", which is how a database writes a moment and no ward does. */
const MACHINE_TIME = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** What a template that was handed nothing prints. */
const UNFILLED = /\b(?:undefined|null|NaN)\b|Invalid Date|\[object |\$\{|\{\{/;

/** Each reason a text should not be sent as it is. Empty when there is none. */
export function smsProblems(body: string): string[] {
  if (body.trim() === '') return ['The message is empty.'];

  const problems: string[] = [];

  const encoding = smsEncoding(body);
  if (encoding.unsupported.length > 0) {
    const shown = encoding.unsupported.map((char) => JSON.stringify(char)).join(', ');
    problems.push(
      `Not in the GSM-7 alphabet: ${shown}. One such character makes the whole message UCS-2, at 70 characters to a segment and not 160.`,
    );
  }
  if (encoding.segments > MAX_SEGMENTS) {
    problems.push(
      `${encoding.segments} segments (${encoding.units} places in ${encoding.encoding}); a text carries at most ${MAX_SEGMENTS}, and each is paid for.`,
    );
  }

  if (EMAIL.test(body)) problems.push('Carries an email address.');

  const phone = [...body.matchAll(NUMBER_SHAPED)].find((match) => isNigerianPhone(match[0].replace(/[\s().-]/g, '')));
  if (phone) problems.push(`Carries a phone number: ${phone[0].trim()}.`);

  if (LONG_DIGITS.test(body)) {
    problems.push('Carries a run of nine digits or more, which is an account number, a NIN or a phone number.');
  }

  if (/\b(?:UTC|GMT)\b/.test(body)) {
    problems.push('Names UTC or GMT. Times in a message are West Africa Time and say WAT.');
  }
  if (MACHINE_TIME.test(body)) problems.push('Carries a machine timestamp, not a time a person reads.');
  for (const clock of body.matchAll(CLOCK)) {
    const rest = body.slice(clock.index + clock[0].length);
    const sentenceEnd = rest.search(/[.!?](?:\s|$)/);
    const sentence = sentenceEnd === -1 ? rest : rest.slice(0, sentenceEnd);
    if (!/\bWAT\b/.test(sentence)) problems.push(`The time ${clock[0]} is not followed by WAT.`);
  }

  if (UNFILLED.test(body)) problems.push('A value was not filled in: the text carries a placeholder or "undefined".');

  return problems;
}
