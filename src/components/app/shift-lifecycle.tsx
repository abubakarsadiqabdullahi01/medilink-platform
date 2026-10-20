import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  LIFECYCLE_STEPS,
  lifecycleOf,
  turnLabel,
  type Lifecycle,
  type LifecycleInput,
} from '@/components/app/lifecycle';

/**
 * Where a shift is, and whose turn it is.
 *
 * The steps are drawn the same way for everyone and the line under them is the part that changes:
 * "Your turn" to the person who has to act, who it is waiting for otherwise. On a phone the six
 * labels do not fit, so it is a bar of six segments and the name of the current one — the same
 * information in the width there is.
 *
 * `compact` is for a card in a list, where six labelled steps for every row would be noise: the
 * bar and the sentence, nothing else.
 */
export function ShiftLifecycle({
  state,
  viewer,
  compact = false,
  className,
}: {
  state: LifecycleInput;
  viewer: 'facility' | 'practitioner';
  compact?: boolean;
  className?: string;
}) {
  const result: Lifecycle = lifecycleOf(state);
  const total = LIFECYCLE_STEPS.length;
  const yours = result.turn === viewer;

  return (
    <section aria-label="Where this shift is" className={cn('space-y-3', className)}>
      {compact ? null : (
        <ol className="hidden items-center sm:flex">
          {LIFECYCLE_STEPS.map((label, index) => {
            const done = index < result.current;
            const current = index === result.current;
            return (
              <li
                key={label}
                aria-current={current ? 'step' : undefined}
                className={cn('flex items-center', index < total - 1 && 'flex-1')}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                      done && 'border-success bg-success text-success-foreground',
                      current && 'border-primary bg-primary text-primary-foreground',
                      !done && !current && 'border-input text-muted-foreground',
                    )}
                  >
                    {done ? <Check className="size-4" aria-hidden="true" /> : index + 1}
                  </span>
                  <span className={cn('text-sm', current ? 'font-semibold' : done ? '' : 'text-muted-foreground')}>
                    {label}
                    <span className="sr-only">{done ? ' (done)' : current ? ' (in progress)' : ' (not yet)'}</span>
                  </span>
                </span>
                {index < total - 1 ? (
                  <span
                    aria-hidden="true"
                    className={cn('mx-3 h-px flex-1', index < result.current ? 'bg-success' : 'bg-border')}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {/* The bar: the whole display on a phone, and the whole of a compact card. */}
      <div className={cn(compact ? '' : 'sm:hidden')}>
        <div
          role="progressbar"
          aria-label="Shift progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={result.current}
          aria-valuetext={`Step ${result.current + 1} of ${total}: ${LIFECYCLE_STEPS[result.current]}`}
          className="flex gap-1"
        >
          {LIFECYCLE_STEPS.map((label, index) => (
            <span
              key={label}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                index < result.current ? 'bg-success' : index === result.current ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Step {result.current + 1} of {total} · <span className="font-medium text-foreground">{LIFECYCLE_STEPS[result.current]}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge variant={yours ? 'warning' : 'secondary'}>{turnLabel(result.turn, viewer)}</Badge>
        <p className="text-sm leading-relaxed">{result.message}</p>
      </div>
    </section>
  );
}
