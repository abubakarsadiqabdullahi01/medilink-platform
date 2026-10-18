import { CircleAlert, Clock, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * How long something has been waiting, as a fact and as a prompt.
 *
 * An operations queue is cleared oldest-first, and "oldest" is the only thing in a row
 * that tells the person which one to pick up. It used to be plain muted text ("5 days
 * ago") that looked the same at five minutes and at five weeks. This says how long, in
 * words, and past a threshold adds the word "overdue" and a different mark, so the prompt
 * survives a greyscale screen, a projector and a reader who does not see amber.
 *
 * The thresholds are a default and each queue may pass its own: a clinical incident
 * waiting a day is a problem, a suggestion waiting a week is not.
 */

export type AgeTone = 'fresh' | 'ageing' | 'overdue';

export interface AgeThresholds {
  ageingAfterHours: number;
  overdueAfterHours: number;
}

export const DEFAULT_AGE: AgeThresholds = { ageingAfterHours: 48, overdueAfterHours: 120 };

const HOUR = 3_600_000;

export function ageTone(
  since: string | Date,
  now: Date = new Date(),
  thresholds: AgeThresholds = DEFAULT_AGE,
): AgeTone {
  const hours = (now.getTime() - new Date(since).getTime()) / HOUR;
  if (hours >= thresholds.overdueAfterHours) return 'overdue';
  if (hours >= thresholds.ageingAfterHours) return 'ageing';
  return 'fresh';
}

/** "12 minutes", "5 hours", "9 days": the largest whole unit, never "0 days". */
export function waitingFor(since: string | Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000));
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

const TONE: Record<AgeTone, { icon: LucideIcon; className: string }> = {
  fresh: { icon: Clock, className: 'text-muted-foreground' },
  ageing: { icon: TriangleAlert, className: 'font-medium text-warning' },
  overdue: { icon: CircleAlert, className: 'font-semibold text-destructive-text' },
};

export function QueueAge({
  since,
  label = 'Waiting',
  thresholds,
  className,
}: {
  since: string | Date;
  label?: string;
  thresholds?: AgeThresholds;
  className?: string;
}) {
  const tone = ageTone(since, new Date(), thresholds);
  const { icon: Icon, className: toneClass } = TONE[tone];
  return (
    <time
      dateTime={new Date(since).toISOString()}
      className={cn('tabular inline-flex items-center gap-1.5 text-sm', toneClass, className)}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>
        {label} {waitingFor(since)}
        {tone === 'overdue' ? ' · overdue' : tone === 'ageing' ? ' · getting old' : ''}
      </span>
    </time>
  );
}
