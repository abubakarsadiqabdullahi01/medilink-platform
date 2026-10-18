/**
 * Where the reader is, in terms of the menu (UXA-14).
 *
 * The menu used to mark an item only when the path matched it exactly, so a deep page
 * — one shift, opened from the list of shifts — lit nothing and gave no sign of which
 * part of the console it belonged to. The item that owns a path is the one with the
 * longest href that the path is, or sits under: `/facility/shifts/abc` belongs to
 * `/facility/shifts`, not to `/facility`, which is also a prefix of it.
 */
export function activeHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const owns = pathname === href || pathname.startsWith(`${href}/`);
    if (owns && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

export interface Crumb {
  label: string;
  /** Absent on the page you are on. */
  href?: string;
}

const RECORD_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;

/** A path segment as a reader would say it: an id is "Details", a slug is its words. */
export function segmentLabel(segment: string): string {
  if (RECORD_ID.test(segment)) return 'Details';
  const words = decodeURIComponent(segment).replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The trail above a deep page: the menu item it belongs to, then what is below it.
 * Empty on a page that is itself a menu item, and on one the menu does not own (the
 * facility sign-up page, say) — a one-step trail would only repeat the heading.
 */
export function breadcrumbsFor(
  pathname: string,
  items: { href: string; label: string }[],
): Crumb[] {
  const owner = activeHref(
    pathname,
    items.map((item) => item.href),
  );
  if (owner === null || owner === pathname) return [];

  const item = items.find((candidate) => candidate.href === owner);
  const rest = pathname
    .slice(owner.length)
    .split('/')
    .filter(Boolean);

  const trail: Crumb[] = [{ label: item?.label ?? segmentLabel(owner), href: owner }];
  let href = owner;
  rest.forEach((segment, index) => {
    href = `${href}/${segment}`;
    const last = index === rest.length - 1;
    trail.push(last ? { label: segmentLabel(segment) } : { label: segmentLabel(segment), href });
  });
  return trail;
}
