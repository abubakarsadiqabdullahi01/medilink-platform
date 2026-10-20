'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { hasImage } from '@/lib/ui/images';

export type IllustrationName = 'shifts' | 'offers' | 'all-clear' | 'not-found';

/**
 * A spot illustration for an empty or error state, or the icon it replaces if the file is not there.
 *
 * Four pictures, one style, in /public/images/empty. They are optional: until a file exists, or if it
 * fails to load, the icon the screen already had is shown in a box of the same size, so the layout does
 * not change when the pictures arrive. A plain <img> and not next/image: they are a few kilobytes,
 * decorative, and may be absent, which would otherwise send the image optimiser a request that can only
 * fail.
 */
export function Illustration({
  name,
  fallback,
  size = 'md',
  className,
}: {
  name: IllustrationName;
  fallback?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const present = hasImage(`empty/${name}.webp`);

  // The picture is in the server's HTML, so it can fail before React is attached to hear about it:
  // `onError` never fires for that, and the person would be left looking at a broken-image box. A
  // file that has finished loading with no width is the same failure, found after the fact.
  useEffect(() => {
    const element = image.current;
    if (element?.complete && element.naturalWidth === 0) setFailed(true);
  }, []);

  const box = size === 'sm' ? 'size-24' : 'size-36';

  if (!present || failed) {
    return fallback ? (
      <div className={cn('flex items-center justify-center text-muted-foreground [&_svg]:size-8', className)}>
        {fallback}
      </div>
    ) : null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={image}
      src={`/images/empty/${name}.webp`}
      alt=""
      width={480}
      height={480}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn(box, 'object-contain', className)}
    />
  );
}
