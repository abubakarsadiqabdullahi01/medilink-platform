'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  applyTextSize,
  readTextSize,
  saveTextSize,
  type TextSize,
} from '@/lib/ui/text-size';

const OPTIONS: { size: TextSize; label: string; name: string }[] = [
  { size: 'normal', label: 'A', name: 'Normal text' },
  { size: 'large', label: 'A+', name: 'Larger text' },
  { size: 'projector', label: 'A++', name: 'Largest text, for a projector' },
];

/**
 * A, A+ and A++: the direct answer to "I cannot read this". Three plain buttons
 * rather than a menu, so the choice is one tap and the current one is visible.
 */
export function TextSizeControl({
  className,
  tone = 'light',
}: {
  className?: string;
  /** `dark` is for a dark surface (the landing page's footer), where the default's dark text cannot be read. */
  tone?: 'light' | 'dark';
}) {
  const [size, setSize] = useState<TextSize>('normal');

  useEffect(() => {
    const stored = readTextSize();
    setSize(stored);
    applyTextSize(stored);
  }, []);

  function choose(next: TextSize) {
    setSize(next);
    applyTextSize(next);
    saveTextSize(next);
  }

  return (
    <div role="group" aria-label="Text size" className={cn('flex items-center gap-0.5', className)}>
      {OPTIONS.map((option) => (
        <button
          key={option.size}
          type="button"
          // The visible text is part of the name (WCAG 2.5.3): somebody using voice control says what they
          // see, "A plus", and a name that does not contain it cannot be reached. The words come first
          // because that is what a screen reader reads out.
          aria-label={`${option.name}, ${option.label}`}
          aria-pressed={size === option.size}
          onClick={() => choose(option.size)}
          className={cn(
            'inline-flex h-10 min-w-10 items-center justify-center rounded-md px-2 font-semibold transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            tone === 'dark' && 'focus-visible:ring-white focus-visible:ring-offset-brand-deeper',
            size === option.size
              ? tone === 'dark'
                ? 'bg-white text-brand-night'
                : 'bg-primary text-primary-foreground'
              : tone === 'dark'
                ? 'text-white hover:bg-white/10'
                : 'text-foreground hover:bg-accent',
            // The label itself shows what it does.
            option.size === 'normal' && 'text-sm',
            option.size === 'large' && 'text-base',
            // For a projector, which a phone is not: offered from tablet width up, so the
            // header of a phone is never wider than the phone.
            option.size === 'projector' && 'hidden text-lg sm:inline-flex',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
