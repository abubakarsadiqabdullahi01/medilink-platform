'use client';

import { useId, useState, type ReactNode } from 'react';
import { ListFilter, Search, X } from 'lucide-react';
import { useMediaQuery } from '@/lib/ui/media-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * Search and filters, the same on every list.
 *
 * Every queue had its own: a card of three fields on one page, a row of selects on the
 * next, none that said how many filters were on, and on a phone all of them open at once,
 * pushing the first result below the fold. This is one pattern.
 *
 * - **Search** is always on screen: it is the thing most people type into.
 * - **Filters** sit in the card on a wide screen. On a phone they collapse behind one
 *   "Filters" button that carries the count of those applied, and open in a bottom sheet
 *   with "Clear filters" and "Show results" within reach of a thumb.
 * - **"Clear filters"** is there whenever anything is applied, in both layouts, so the way
 *   back to the full list is never a hunt.
 *
 * It owns no state about the filters themselves. The page holds them (they are part of its
 * query key), says how many are `activeCount`, and gives `onClear` and `onApply`.
 */
export function FilterBar({
  searchLabel,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  onSubmit,
  activeCount,
  onClear,
  children,
  summary,
  busy = false,
}: {
  searchLabel?: string;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /** Run the search now. Optional: a page that filters live has no submit. */
  onSubmit?: () => void;
  /** How many filters are currently applied, search included. */
  activeCount: number;
  onClear: () => void;
  /** The filter fields: wrap each in a Field so it has a label. */
  children?: ReactNode;
  /** "13 on this page", "Showing 50 of 212". Announced politely when it changes. */
  summary?: ReactNode;
  busy?: boolean;
}) {
  const wide = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState(false);
  const searchId = useId();
  const hasSearch = onSearchChange !== undefined;

  const search = hasSearch ? (
    <div className="min-w-0 flex-1">
      <Label htmlFor={searchId} className="mb-1.5 block text-base font-medium leading-snug">
        {searchLabel ?? 'Search'}
      </Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={searchId}
          type="search"
          value={searchValue ?? ''}
          placeholder={searchPlaceholder}
          onChange={(event) => onSearchChange(event.target.value)}
          className="pl-9"
        />
      </div>
    </div>
  ) : null;

  const clear =
    activeCount > 0 ? (
      <Button type="button" variant="ghost" onClick={onClear} className="shrink-0">
        <X /> Clear filters
      </Button>
    ) : null;

  const status = (
    <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
      {busy ? 'Updating…' : summary}
    </p>
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit?.();
    setOpen(false);
  };

  if (wide) {
    return (
      <form onSubmit={submit} role="search" aria-label="Filter this list" className="mb-4">
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            {search}
            {children}
            {onSubmit ? (
              <Button type="submit">
                <Search /> Search
              </Button>
            ) : null}
            {clear}
          </div>
          {status}
        </Card>
      </form>
    );
  }

  return (
    <div className="mb-4 space-y-2">
      <form onSubmit={submit} role="search" aria-label="Filter this list" className="space-y-3">
        <div className="flex items-end gap-2">
          {search}
          {children ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              className="shrink-0"
            >
              <ListFilter />
              Filters
              {activeCount > 0 ? (
                <span className="tabular -mr-1 ml-0.5 inline-flex size-6 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  <span className="sr-only">{activeCount} applied, </span>
                  {activeCount}
                </span>
              ) : null}
            </Button>
          ) : null}
        </div>
      </form>
      <div className="flex items-center justify-between gap-2">
        {status}
        {clear}
      </div>

      {children ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>
                {activeCount > 0 ? `${activeCount} applied.` : 'None applied.'} Results update as
                you choose.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 flex flex-col gap-4">{children}</div>
            <SheetFooter className="mt-6 gap-2 sm:space-x-0">
              <Button type="button" onClick={() => setOpen(false)}>
                Show results
              </Button>
              {activeCount > 0 ? (
                <Button type="button" variant="outline" onClick={onClear}>
                  Clear filters
                </Button>
              ) : null}
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
