import { cn } from '@/lib/utils';
import { formatNaira } from '@/components/app/format';
import { ArrowRight, Equal } from 'lucide-react';

/**
 * Naira, set in tabular figures so a column of them lines up, and always through
 * `formatNaira` — the one place kobo becomes a decimal.
 */
export function Money({
  kobo,
  className,
  strong = false,
}: {
  kobo: number | null | undefined;
  className?: string;
  strong?: boolean;
}) {
  return (
    <span className={cn('tabular whitespace-nowrap', strong && 'font-semibold', className)}>
      {formatNaira(kobo)}
    </span>
  );
}

/**
 * Two figures for the same thing side by side: hours or pay as submitted, and as approved.
 *
 * When a hospital corrects a timesheet the practitioner has to see, at a glance, *what they
 * claimed*, *what was approved* and *by how much it moved* — three numbers that a status
 * badge and a total cannot give. The difference is written as a word and a sign ("₦2,000
 * less"), not left to a red or green number.
 */
export function SubmittedVsApproved({
  label,
  submitted,
  approved,
  format,
  unit = 'amount',
}: {
  label: string;
  submitted: number;
  approved: number | null;
  format: (value: number) => string;
  /** Names the difference aloud: "amount", "hours". */
  unit?: string;
}) {
  const diff = approved === null ? null : approved - submitted;
  return (
    <div
      className="rounded-lg border bg-muted/30 p-4"
      role="group"
      aria-label={`${label}: submitted compared with approved`}
    >
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Submitted</p>
          <p className="tabular text-xl font-semibold">{format(submitted)}</p>
        </div>
        {diff === 0 ? (
          <Equal className="mb-1.5 size-5 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ArrowRight className="mb-1.5 size-5 text-muted-foreground" aria-hidden="true" />
        )}
        <div>
          <p className="text-sm text-muted-foreground">Approved</p>
          <p className="tabular text-xl font-semibold">
            {approved === null ? 'Not yet' : format(approved)}
          </p>
        </div>
      </div>
      {diff !== null ? (
        <p className="mt-2 text-sm font-medium">
          {diff === 0
            ? 'Approved as submitted.'
            : `${format(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'} than submitted (${unit}).`}
        </p>
      ) : null}
    </div>
  );
}
