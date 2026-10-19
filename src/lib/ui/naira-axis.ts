/**
 * A tick on a money axis: "₦1.5M", "₦250k", "₦800".
 *
 * Full figures on a short axis collide with each other and lose their first digit to the edge of
 * the chart. The exact amount is in the tooltip, and in the table under each chart; this is only
 * a scale. Kobo in, as everything money is, and rounded to the nearest naira before it is
 * shortened.
 */
export function nairaTick(kobo: number): string {
  const value = Math.round(kobo / 100);
  if (value >= 1_000_000) return `₦${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `₦${+(value / 1_000).toFixed(1)}k`;
  return `₦${value}`;
}
