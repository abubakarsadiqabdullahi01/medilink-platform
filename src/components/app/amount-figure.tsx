import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNaira } from '@/components/app/format';

/**
 * One amount of money, said plainly, with a line on what it counts.
 *
 * A failed fetch says so rather than showing ₦0.00: "you are owed nothing"
 * and "we could not find out" must never look the same, and only one of them
 * is safe to act on.
 */
export function AmountFigure({
  label,
  amountKobo,
  hint,
  isPending,
  isError,
  emphasise = false,
}: {
  label: string;
  amountKobo: number;
  hint: string;
  isPending: boolean;
  isError: boolean;
  /** Darken a non-zero figure — the one the page exists to show. */
  emphasise?: boolean;
}) {
  // A named group, so a screen reader announces "Outstanding, ₦12,000.00"
  // rather than a bare figure with nothing to say what it counts.
  return (
    <Card role="group" aria-label={label}>
      <CardContent className="pt-6">
        <p className="text-sm font-medium">{label}</p>
        {isPending ? (
          <Skeleton className="mt-2 h-9 w-32" />
        ) : isError ? (
          <p className="mt-2 text-sm text-destructive-text">Could not load</p>
        ) : (
          <p
            className={
              emphasise && amountKobo > 0
                ? 'tabular mt-1 text-3xl font-semibold'
                : 'tabular mt-1 text-3xl font-semibold text-muted-foreground'
            }
          >
            {formatNaira(amountKobo)}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
