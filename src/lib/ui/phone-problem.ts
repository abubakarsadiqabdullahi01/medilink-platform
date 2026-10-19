import { normalizeNigerianPhone } from '@/lib/phone';

/**
 * What is wrong with a phone number somebody has typed, in a sentence, or `undefined` if nothing.
 *
 * The server refuses a number it cannot normalise, with this same wording; asking the same
 * question here means the person is told beside the field, as they leave it, rather than after a
 * round trip. The rule is `normalizeNigerianPhone`'s alone — nothing is decided twice.
 */
export function phoneProblem(value: string): string | undefined {
  if (!value.trim()) return 'Enter their phone number.';
  try {
    normalizeNigerianPhone(value);
    return undefined;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : 'Enter a Nigerian mobile number, for example 0803 123 4567.';
  }
}
