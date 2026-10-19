import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Previous / next under a paged list, the same everywhere.
 *
 * Buttons are the full touch size and the page number is a status line, so a screen reader
 * hears "Page 2" when it changes. Nothing is drawn for a list that fits on one page.
 */
export function Pager({
  pageIndex,
  hasNext,
  busy = false,
  onPrevious,
  onNext,
  previousLabel = 'Previous',
  nextLabel = 'Next',
}: {
  /** "Newer" / "Older" for a list that is ordered by time; the default is for everything else. */
  previousLabel?: string;
  nextLabel?: string;
  pageIndex: number;
  hasNext: boolean;
  busy?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (pageIndex === 0 && !hasNext) return null;

  return (
    <nav aria-label="Pages" className="mt-5 flex items-center justify-between gap-3">
      <Button variant="outline" disabled={pageIndex === 0 || busy} onClick={onPrevious}>
        <ChevronLeft />
        {previousLabel}
      </Button>
      <p role="status" aria-live="polite" className="tabular text-sm text-muted-foreground">
        Page {pageIndex + 1}
        {busy ? ' · loading' : ''}
      </p>
      <Button variant="outline" disabled={!hasNext || busy} onClick={onNext}>
        {nextLabel}
        <ChevronRight />
      </Button>
    </nav>
  );
}
