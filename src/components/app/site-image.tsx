import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * A picture from /public, or a quiet block of the same shape if the file is not there yet.
 *
 * The photographs on the public pages arrive after the page is built, and a page with a hole in it
 * is worse than a page with a pale rectangle where a picture will go. The box keeps its aspect ratio
 * either way, so when a file is dropped in nothing around it moves. Server component: it asks the
 * filesystem, which a browser cannot.
 *
 * `alt` is for the picture; the placeholder is decorative and says nothing.
 */
export function SiteImage({
  src,
  alt,
  width,
  height,
  sizes,
  priority = false,
  className,
}: {
  /** Path under /public, without the leading slash: "images/landing/practitioner-phone.webp". */
  src: string;
  alt: string;
  /** The shape the box takes, and the size the file is expected at. */
  width: number;
  height: number;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const present = existsSync(join(process.cwd(), 'public', src));

  return (
    <div
      className={cn('relative overflow-hidden rounded-xl bg-tint', className)}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {present ? (
        <Image src={`/${src}`} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 border border-dashed border-primary/15" />
      )}
    </div>
  );
}
