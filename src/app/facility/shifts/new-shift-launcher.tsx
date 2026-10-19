'use client';

import { Suspense, lazy, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

const load = () =>
  import('./new-shift-dialog').then((module) => ({ default: module.NewShiftDialog }));
const NewShiftDialog = lazy(load);

/**
 * The "Publish a shift" button, with the form behind it loaded only when it is wanted.
 *
 * The form is the heaviest thing a facility's first screen could carry — a schema validator, a
 * form library and every control it uses — and most visits to the dashboard or the shifts list
 * never open it. Bundled with the page it added about 60 kB to a first load that is already
 * on a phone over a weak connection. Here the page ships a button; the form is fetched when the
 * pointer or a finger first goes towards it (so it is usually ready by the time it is pressed)
 * and opens itself the moment it arrives.
 */
export function NewShiftLauncher({ facilityId, size }: { facilityId: string; size?: 'lg' }) {
  const [wanted, setWanted] = useState(false);

  const label = (
    <>
      <CalendarPlus />
      Publish a shift
    </>
  );

  if (!wanted) {
    return (
      <Button
        size={size}
        onClick={() => setWanted(true)}
        onPointerEnter={() => void load()}
        onFocus={() => void load()}
        onTouchStart={() => void load()}
      >
        {label}
      </Button>
    );
  }

  return (
    <Suspense
      fallback={
        <Button size={size} loading>
          {label}
        </Button>
      }
    >
      <NewShiftDialog
        facilityId={facilityId}
        defaultOpen
        trigger={<Button size={size}>{label}</Button>}
      />
    </Suspense>
  );
}
