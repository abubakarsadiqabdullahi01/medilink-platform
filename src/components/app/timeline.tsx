import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, CircleDot, Circle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The life of a record, in order: submitted, reviewed, corrected, approved, paid.
 *
 * A shift, a timesheet, a dispute and an invoice each move through several states, and a
 * single status badge says only where it is now, not how it got there or what is left. A
 * vertical list answers "what happened, when, and what is next" in the order a person
 * thinks it. Each step is marked by shape as well as colour — a tick for done, a dot for
 * where it is now, an empty ring for what has not happened, an alert for where it went
 * wrong — and the state is also spoken ("Done", "Current", "Not yet", "Problem").
 */
export type TimelineState = 'done' | 'current' | 'upcoming' | 'problem';

export interface TimelineStep {
  id: string;
  title: ReactNode;
  state: TimelineState;
  /** Already formatted, in WAT. Absent for a step that has not happened. */
  when?: string;
  /** Who, or why: "Reviewed by an officer", a reason a timesheet was rejected. */
  detail?: ReactNode;
}

const MARK: Record<TimelineState, { icon: LucideIcon; className: string; word: string }> = {
  done: { icon: CircleCheck, className: 'text-success', word: 'Done' },
  current: { icon: CircleDot, className: 'text-primary', word: 'Current' },
  upcoming: { icon: Circle, className: 'text-muted-foreground', word: 'Not yet' },
  problem: { icon: CircleAlert, className: 'text-destructive-text', word: 'Problem' },
};

export function Timeline({ steps, label }: { steps: TimelineStep[]; label: string }) {
  return (
    <ol aria-label={label} className="relative space-y-0">
      {steps.map((step, index) => {
        const mark = MARK[step.state];
        const Icon = mark.icon;
        const last = index === steps.length - 1;
        return (
          <li
            key={step.id}
            className="relative flex gap-3 pb-5 last:pb-0"
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            {last ? null : (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-[0.6875rem] top-6 h-[calc(100%-1.5rem)] w-px',
                  step.state === 'done' ? 'bg-success/40' : 'bg-border',
                )}
              />
            )}
            <Icon
              className={cn('relative mt-0.5 size-6 shrink-0 bg-card', mark.className)}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'font-medium leading-snug',
                  step.state === 'upcoming' && 'text-muted-foreground',
                )}
              >
                <span className="sr-only">{mark.word}: </span>
                {step.title}
              </p>
              {step.when ? (
                <p className="tabular text-sm text-muted-foreground">{step.when}</p>
              ) : null}
              {step.detail ? (
                <div className="mt-1 text-sm leading-relaxed">{step.detail}</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
