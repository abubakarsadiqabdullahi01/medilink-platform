/**
 * What a text message costs, from its characters. Pure, no network.
 *
 * A text is sent in the GSM 03.38 alphabet when every character is in it: 160 characters to a
 * segment, 153 once it is more than one. One character outside the alphabet turns the whole
 * message into UCS-2: 70 to a segment, 67 once it is more than one. A smart apostrophe in a
 * hospital's name, or an ellipsis a template adds, more than doubles what a message costs and
 * nothing on the screen shows it. This is how the tests see it.
 *
 * Nigerian names are the usual way in: the Yoruba and Igbo letters with a dot or a tone mark
 * (Ọ, ọ, Ṣ, ẹ, ị) are not in the alphabet, and a name that carries one cannot be made to fit.
 * The templates therefore stay inside the alphabet themselves, so that a message is UCS-2 only
 * when a person's own words made it so.
 */

/** The GSM 03.38 default alphabet, one place each. */
const BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/** Reached by an escape, so each takes two places. */
const EXTENDED = '^{}\\[~]|€\f';

const BASIC_SET = new Set(BASIC);
const EXTENDED_SET = new Set(EXTENDED);

export type SmsEncoding = {
  encoding: 'GSM-7' | 'UCS-2';
  /** Places used: septets in GSM-7 (the extension characters count two), UTF-16 code units in UCS-2. */
  units: number;
  segments: number;
  /** Each character that is not in the GSM alphabet, once, in the order it first appears. */
  unsupported: string[];
};

const LIMITS = {
  'GSM-7': { single: 160, joined: 153 },
  'UCS-2': { single: 70, joined: 67 },
} as const;

export function smsEncoding(text: string): SmsEncoding {
  const unsupported: string[] = [];
  let septets = 0;
  for (const char of text) {
    if (BASIC_SET.has(char)) septets += 1;
    else if (EXTENDED_SET.has(char)) septets += 2;
    else if (!unsupported.includes(char)) unsupported.push(char);
  }

  const encoding = unsupported.length === 0 ? 'GSM-7' : 'UCS-2';
  const units = encoding === 'GSM-7' ? septets : text.length;
  const { single, joined } = LIMITS[encoding];
  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / joined);

  return { encoding, units, segments, unsupported };
}

/**
 * What a phone keyboard types that the alphabet does not have, and the plain character that stands
 * for it. A facility name typed on a phone arrives with a curly apostrophe, and that one character
 * would make the message cost twice as much.
 */
const PLAIN: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2026': '...',
  '\u00a0': ' ',
};

/**
 * The same words inside the alphabet where that can be done without changing them. Letters that a
 * person's name needs are left as they are: "Ola" is not the name of someone called Ọlá, and the message
 * costs more because of it, which is the right way round.
 */
export function toSmsText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\u20a6\s*/g, 'NGN ')
    .replace(/[\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u00a0]/g, (char) => PLAIN[char] ?? char);
}
