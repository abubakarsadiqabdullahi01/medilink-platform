/**
 * What the connection is like, for a banner (UXA-09).
 *
 * Most of this product is used on a phone over a mobile network that comes and goes. The worst
 * thing a screen can do then is look the same whether it worked or not: a button that spins for
 * thirty seconds and ends in "Something went wrong" tells nobody whether to wait, retry, or move
 * to where there is signal. So the console says so, once, at the top, as soon as it knows.
 *
 * `effectiveType` is only reported by Chromium-based browsers, which is most phones here; where it
 * is missing the answer is "ok" rather than a guess.
 */

export type ConnectionState = 'offline' | 'slow' | 'ok';

export function describeConnection(input: {
  online: boolean;
  effectiveType?: string | null;
}): ConnectionState {
  if (!input.online) return 'offline';
  if (input.effectiveType === 'slow-2g' || input.effectiveType === '2g') return 'slow';
  return 'ok';
}
