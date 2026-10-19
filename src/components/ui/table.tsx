'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The table, inside a box that scrolls sideways when the table is wider than the screen.
 *
 * A box that scrolls with a mouse wheel must also scroll with a keyboard. When — and only when —
 * the table does overflow, the box becomes a focusable region named for the table's caption, so
 * the arrow keys move it. A table that fits adds no tab stop.
 */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => {
    const box = React.useRef<HTMLDivElement>(null);
    const [scrolls, setScrolls] = React.useState<string | null>(null);

    React.useEffect(() => {
      const element = box.current;
      if (!element) return;
      const check = () =>
        setScrolls(
          element.scrollWidth > element.clientWidth + 1
            ? element.querySelector('caption')?.textContent?.trim() || 'Table'
            : null,
        );
      check();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(check);
      observer.observe(element);
      if (element.firstElementChild) observer.observe(element.firstElementChild);
      return () => observer.disconnect();
    }, []);

    return (
      <div
        ref={box}
        className="relative w-full overflow-auto"
        {...(scrolls
          ? { tabIndex: 0, role: 'region', 'aria-label': `${scrolls}, scrolls sideways` }
          : {})}
      >
        <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
      </div>
    );
  },
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
