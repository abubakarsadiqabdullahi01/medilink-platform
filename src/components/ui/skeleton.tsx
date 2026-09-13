import { cn } from '@/lib/utils';

/**
 * A shape where content will be, not a spinner.
 *
 * A queue that flashes "Loading…" and then jumps to eight cards is a queue
 * that moves under the cursor. Reserving the space costs nothing and stops
 * the click that lands on the wrong row.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-md bg-muted', className)}
      {...props}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-background/60 to-transparent" />
    </div>
  );
}

export { Skeleton };
