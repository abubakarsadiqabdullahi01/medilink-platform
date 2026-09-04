/**
 * Nigerian mobile numbers, normalised to E.164 once at the edge.
 *
 * The phone number is the primary identifier (Section 9.2), so it must have
 * exactly one canonical form. "0803 123 4567", "+2348031234567" and
 * "2348031234567" are the same practitioner, and a duplicate account created
 * by inconsistent formatting is a verification failure, not a cosmetic bug.
 */
export class PhoneFormatError extends Error {
  readonly code = 'invalid_phone';
  constructor(message = 'Enter a Nigerian mobile number, for example 0803 123 4567.') {
    super(message);
    this.name = 'PhoneFormatError';
  }
}

/**
 * Assigned mobile network codes. Deliberately an allow-list: accepting any
 * ten digits would let a landline or a typo through to an SMS bill that
 * silently never arrives.
 */
const MOBILE_PREFIXES = [
  '701', '702', '703', '704', '705', '706', '707', '708', '709',
  '801', '802', '803', '804', '805', '806', '807', '808', '809',
  '810', '811', '812', '813', '814', '815', '816', '817', '818', '819',
  '901', '902', '903', '904', '905', '906', '907', '908', '909',
  '911', '912', '913', '915', '916', '917', '918',
];

export function normalizeNigerianPhone(input: string): string {
  if (typeof input !== 'string') throw new PhoneFormatError();

  const cleaned = input.replace(/[\s()\-.]/g, '');
  if (!/^\+?\d+$/.test(cleaned)) throw new PhoneFormatError();

  let national: string;
  if (cleaned.startsWith('+234')) national = cleaned.slice(4);
  else if (cleaned.startsWith('234')) national = cleaned.slice(3);
  else if (cleaned.startsWith('0')) national = cleaned.slice(1);
  else national = cleaned;

  if (national.length !== 10) throw new PhoneFormatError();

  const prefix = national.slice(0, 3);
  if (!MOBILE_PREFIXES.includes(prefix)) {
    throw new PhoneFormatError('That mobile prefix is not recognised. Check the number and try again.');
  }

  return `+234${national}`;
}

/** True when the input is a usable Nigerian mobile number. */
export function isNigerianPhone(input: string): boolean {
  try {
    normalizeNigerianPhone(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Display form for support screens and audit reasons. Never log or display a
 * full number where a masked one will do.
 */
export function maskPhone(e164: string): string {
  if (e164.length < 8) return '***';
  return `${e164.slice(0, 7)}***${e164.slice(-3)}`;
}
