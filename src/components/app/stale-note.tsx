import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Said when a refresh failed but the list the person is working from is still on screen.
 *
 * Replacing a list with an error because the *second* request failed throws away something
 * perfectly good, and drawing the old list with no word says it is current when it is not. This
 * keeps the rows and tells the truth about their age.
 */
export function StaleNote({
  show,
  onRetry,
  retrying = false,
  what = 'this list',
}: {
  show: boolean;
  onRetry: () => void;
  retrying?: boolean;
  what?: string;
}) {
  if (!show) return null;
  return (
    <Alert variant="warning" className="mb-4">
      <TriangleAlert />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>Could not refresh {what}. What is shown may be out of date.</span>
        <Button variant="outline" size="sm" onClick={onRetry} loading={retrying}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
