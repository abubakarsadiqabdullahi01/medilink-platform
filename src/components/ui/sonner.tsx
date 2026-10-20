'use client';

import { Toaster as Sonner } from 'sonner';

/**
 * Feedback for actions that succeed.
 *
 * Before this, a successful approval simply made a card disappear, which is
 * indistinguishable from a page reloading oddly. A toast is the difference
 * between "did that work?" and knowing.
 */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'group rounded-lg border bg-card text-card-foreground shadow-raised text-sm p-4 flex gap-3 items-start',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-muted text-muted-foreground',
          error: 'border-destructive/30',
          success: 'border-success/30',
        },
      }}
    />
  );
}
