import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Medilink's mark: a medical cross with a node beside it. A cross says what the work is; the node,
 * connection — the platform sitting between a practitioner and a facility.
 *
 * Drawn inline so it costs no request and takes the page's colours. `reverse` is for a dark surface:
 * a white tile with the cross in teal, since a teal tile would vanish into a teal ground. The same
 * geometry, as files, is in /public/brand and src/app/icon.svg; change them together.
 */
const PLUS =
  'M13 6.5h6A1.5 1.5 0 0 1 20.5 8v4.5H25A1.5 1.5 0 0 1 26.5 14v4a1.5 1.5 0 0 1-1.5 1.5h-4.5V24a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 11.5 24v-4.5H7A1.5 1.5 0 0 1 5.5 18v-4A1.5 1.5 0 0 1 7 12.5h4.5V8A1.5 1.5 0 0 1 13 6.5z';

export function LogoMark({
  tone = 'default',
  className,
}: {
  tone?: 'default' | 'reverse';
  className?: string;
}) {
  const reverse = tone === 'reverse';
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-9 shrink-0', className)}>
      <rect width="32" height="32" rx="8" fill={reverse ? '#ffffff' : 'hsl(var(--primary))'} />
      <path d={PLUS} fill={reverse ? 'hsl(var(--primary))' : '#ffffff'} />
      <circle cx="25.2" cy="6.8" r="3" fill={reverse ? '#3fa7a3' : 'hsl(var(--brand-mint))'} />
    </svg>
  );
}

/**
 * The mark and the name, as a link home.
 *
 * The name is live text rather than the outlined wordmark: it scales with the reader's text size,
 * is read by assistive technology as a word, and needs no second request. The outlined version
 * (public/brand/medilink-logo.svg) is for places that cannot run this: the share card, an email.
 */
export function Logo({
  tone = 'default',
  href = '/',
  className,
}: {
  tone?: 'default' | 'reverse';
  /** Pass null where it is not a link (inside another link). */
  href?: string | null;
  className?: string;
}) {
  const content = (
    <>
      <LogoMark tone={tone} />
      <span
        className={cn(
          'text-xl font-semibold tracking-tight',
          tone === 'reverse' ? 'text-white' : 'text-primary',
        )}
      >
        Medilink
      </span>
    </>
  );
  const classes = cn('inline-flex items-center gap-2.5', className);

  return href === null ? (
    <span className={classes}>{content}</span>
  ) : (
    <Link
      href={href}
      aria-label="Medilink home"
      className={cn(
        classes,
        'rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      {content}
    </Link>
  );
}
