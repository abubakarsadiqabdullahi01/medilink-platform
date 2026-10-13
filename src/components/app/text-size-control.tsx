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
export function TextSizeControl({ className }: { className?: string }) {
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
          aria-label={option.name}
          aria-pressed={size === option.size}
          onClick={() => choose(option.size)}
          className={cn(
            'inline-flex h-10 min-w-10 items-center justify-center rounded-md px-2 font-semibold transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            size === option.size
              ? 'bg-primary text-primary-foreground'
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
