/**
 * Formatting, in one place, because a date shown two ways on two pages is a
 * date somebody misreads.
 */

/** WAT, always. The shifts are in Nigeria and so is everybody reading this. */
export function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "3 hours ago", for a queue where age is the thing you are scanning for. */
export function formatAgo(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);
  const future = seconds < 0;
  const abs = Math.abs(seconds);

  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [2592000, 'day'],
    [31536000, 'month'],
  ];

  const formatter = new Intl.RelativeTimeFormat('en-NG', { numeric: 'auto' });
  let value_ = abs;
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  let divisor = 1;

  for (const [limit, name] of units) {
    if (abs < limit) {
      value_ = Math.round(abs / divisor);
      unit = unit === 'second' && divisor === 1 ? 'second' : unit;
      return formatter.format(future ? value_ : -value_, unit);
    }
    divisor = limit;
    unit = name === 'second' ? 'minute' : name === 'minute' ? 'hour' : name === 'hour' ? 'day' : 'month';
  }

  return formatter.format(future ? Math.round(abs / 31536000) : -Math.round(abs / 31536000), 'year');
}

/**
 * Integer kobo in, naira out. Rule 3: money is only ever computed in kobo,
 * and this is the single place it becomes something with a decimal point.
 */
export function formatNaira(kobo: number | null | undefined): string {
  if (kobo === null || kobo === undefined) return '—';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
  }).format(kobo / 100);
}

/** 480 → "8h 0m". Minutes are how attendance is stored; hours are how it reads. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** A uuid nobody needs to read in full, but which has to be recognisable. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '—';
}
