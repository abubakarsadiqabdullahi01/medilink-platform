'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'size-7 text-xs',
  md: 'size-9 text-sm',
  lg: 'size-14 text-lg',
  xl: 'size-24 text-3xl',
} as const;

/** "Tunde Bakare" → "TB"; one word gives one letter, nothing gives "?". */
export function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return letters || '?';
}

/**
 * The one way a person's face is drawn.
 *
 * It used to be three: a hand-rolled circle of initials in the top bar, another
 * on the profile header, and a generic person icon beside the upload button —
 * so somebody who had uploaded a photograph saw it in exactly one of them.
 * This shows the photograph when there is one and the initials when there is
 * not, everywhere, so the same person always looks the same.
 *
 * A photograph is a short-lived signed URL, so a failed load falls back to the
 * initials rather than leaving a broken-image glyph where a face should be.
 */
export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  // Keyed on the URL, so a new photograph gets a fresh chance after one failed.
  const [failed, setFailed] = useState<string | null>(null);
  const showing = src && failed !== src;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary font-semibold text-primary-foreground',
        SIZES[size],
        className,
      )}
    >
      {showing ? (
        // A signed storage URL, not an asset next/image can optimise without a
        // loader. The disable has to be the line immediately before the element.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className="size-full object-cover"
          onError={() => setFailed(src)}
        />
      ) : (
        <span aria-hidden="true">{initialsOf(name)}</span>
      )}
    </span>
  );
}
