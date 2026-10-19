/**
 * A step button's name, said in full: where it is in the list, what it is called and whether it
 * is the one open, finished or still to do. A row of bare numbers tells a screen reader nothing,
 * and "done" shown only as a tick tells it nothing at all.
 */
export function stepName(
  index: number,
  total: number,
  label: string,
  current: number,
  complete: boolean,
): string {
  const state =
    index === current ? (complete ? 'current, done' : 'current') : complete ? 'done' : 'to do';
  return `Step ${index + 1} of ${total}: ${label} — ${state}`;
}
