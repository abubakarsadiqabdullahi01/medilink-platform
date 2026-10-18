import { cn } from '@/lib/utils';
import type { DescribedEstimate } from '@/modules/rates-contracts/domain/estimate';

/**
 * What a shift comes to, written out for whoever is about to agree to it (M11-04).
 *
 * The sentence says "about" and the notes say what is left out; both come from the server, which
 * is also what prices the invoice, so this only lays them out. The notes are shown rather than
 * folded away: an unpaid break and time past the end are exactly what makes the figure differ from
 * what is later paid, and a reader who was not told is a reader who is surprised.
 */
export function ShiftEstimate({
  estimate,
  className,
}: {
  estimate: DescribedEstimate;
  className?: string;
}) {
  return (
    <div
      data-testid="shift-estimate"
      className={cn('rounded-md border bg-muted/30 p-3 text-sm', className)}
    >
      <p className="font-medium">{estimate.headline}</p>
      {estimate.lines.length > 0 ? (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
          {estimate.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {estimate.notes.length > 0 ? (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {estimate.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
