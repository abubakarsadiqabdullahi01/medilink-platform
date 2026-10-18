import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * One list of records, drawn as a table where there is room and as stacked cards where
 * there is not.
 *
 * A table squeezed onto a 390px phone either scrolls sideways — and the column that
 * matters is the one off the edge — or wraps every cell into a column four words wide. The
 * records a person comes here to act on are not tables; they are things with a name, a
 * state, a time, sometimes an amount and always a next step. So each column says which
 * of those it is, and on a narrow screen the row is rebuilt around them:
 *
 *   identity  — who or what the row is. The card's heading.
 *   status    — where it stands. Top right of the card, never dropped.
 *   (default) — a labelled detail line: dates, amounts, references.
 *   `action`  — the next step. A full-width control at the foot of the card, never hidden
 *               behind a hover or an overflow menu.
 *
 * Both layouts are in the document and CSS shows one, so there is no layout jump and nothing
 * depends on a script; the one that is not shown is `display: none` and so is not read out.
 */
export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  role?: 'identity' | 'status' | 'detail';
  align?: 'left' | 'right';
  /** Keeps a money column's digits lined up. */
  numeric?: boolean;
  /** Narrow screens only: leave this column out of the card. For a column that repeats another. */
  hideOnCard?: boolean;
}

export function DataTable<T>({
  caption,
  rows,
  columns,
  getKey,
  action,
  actionHeader = 'Next step',
  rowTone,
}: {
  /** Names the table for a screen reader; not drawn. */
  caption: string;
  rows: T[];
  columns: Column<T>[];
  getKey: (row: T) => string;
  /** The next step for a row, shown as the last column and at the foot of the card. */
  action?: (row: T) => ReactNode;
  actionHeader?: string;
  /** Marks a row that needs attention with a rule on its leading edge (as well as whatever the cells say). */
  rowTone?: (row: T) => 'warning' | 'danger' | undefined;
}) {
  const identity = columns.find((column) => column.role === 'identity') ?? columns[0];
  const status = columns.find((column) => column.role === 'status');
  const details = columns.filter(
    (column) => column !== identity && column !== status && !column.hideOnCard,
  );

  return (
    <>
      <Card className="hidden overflow-hidden md:block">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  scope="col"
                  className={cn('px-4 text-sm', column.align === 'right' && 'text-right')}
                >
                  {column.header}
                </TableHead>
              ))}
              {action ? (
                <TableHead scope="col" className="px-4 text-right text-sm">
                  {actionHeader}
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const tone = rowTone?.(row);
              return (
                <TableRow
                  key={getKey(row)}
                  className={cn(
                    tone === 'warning' && 'shadow-[inset_3px_0_0_hsl(var(--warning))]',
                    tone === 'danger' && 'shadow-[inset_3px_0_0_hsl(var(--destructive))]',
                  )}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(
                        'px-4 py-3 align-top',
                        column.align === 'right' && 'text-right',
                        column.numeric && 'tabular',
                      )}
                    >
                      {column.cell(row)}
                    </TableCell>
                  ))}
                  {action ? (
                    <TableCell className="px-4 py-3 text-right align-top">{action(row)}</TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <ul className="space-y-3 md:hidden" aria-label={caption}>
        {rows.map((row) => {
          const tone = rowTone?.(row);
          return (
            <li key={getKey(row)}>
              <Card
                className={cn(
                  'space-y-3 p-4',
                  tone === 'warning' && 'border-warning/50',
                  tone === 'danger' && 'border-destructive/50',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 font-medium leading-snug [overflow-wrap:anywhere]">
                    {identity!.cell(row)}
                  </div>
                  {status ? <div className="shrink-0">{status.cell(row)}</div> : null}
                </div>
                {details.length > 0 ? (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                    {details.map((column) => (
                      <div key={column.id} className="min-w-0">
                        <dt className="text-sm text-muted-foreground">{column.header}</dt>
                        <dd
                          className={cn(
                            'text-base [overflow-wrap:anywhere]',
                            column.numeric && 'tabular',
                          )}
                        >
                          {column.cell(row)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {action ? (
                  <div className="[&>*]:w-full [&_a]:w-full [&_button]:w-full">{action(row)}</div>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
