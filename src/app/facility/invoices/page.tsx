'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, ReceiptText } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AmountFigure } from '@/components/app/amount-figure';
import { Money } from '@/components/app/money';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { StatusBadge } from '@/components/app/status-badge';
import { formatDate, formatMinutes } from '@/components/app/format';

/**
 * An invoice still to be paid opens with its shifts showing — up to this many. A month's invoice for
 * a busy hospital has forty, and opened by default they push every other invoice out of reach.
 */
const OPEN_UP_TO = 5;

interface InvoiceLine {
  assignmentId: string;
  practitionerName: string;
  ordinaryMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;
  baseKobo: number;
  premiumKobo: number;
  amountKobo: number;
}

interface Invoice {
  id: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  grossKobo: number;
  status: string;
  issuedAt: string | null;
  paidAt: string | null;
  lines: InvoiceLine[];
}

interface InvoicePage {
  invoices: Invoice[];
  nextCursor: string | null;
  totals: { outstandingKobo: number; outstandingCount: number; paidKobo: number };
}

/** What each invoice is waiting for, in a sentence — the next step is the thing this page is read for. */
function whereItStands(invoice: Invoice): string | null {
  if (invoice.status === 'PAID') {
    return invoice.paidAt ? `Paid on ${formatDate(invoice.paidAt)}.` : 'Paid.';
  }
  if (invoice.status === 'ISSUED') {
    return `${invoice.issuedAt ? `Issued on ${formatDate(invoice.issuedAt)}. ` : ''}Waiting for payment — it shows as paid once Medilink has recorded your transfer.`;
  }
  return invoice.issuedAt ? `Issued on ${formatDate(invoice.issuedAt)}.` : null;
}

/** "8h ordinary · 2h night": only the parts there are, so a plain day shift is one phrase. */
function hoursOf(line: InvoiceLine): string {
  const parts = [`${formatMinutes(line.ordinaryMinutes)} ordinary`];
  if (line.nightMinutes > 0) parts.push(`${formatMinutes(line.nightMinutes)} night`);
  if (line.holidayMinutes > 0) parts.push(`${formatMinutes(line.holidayMinutes)} holiday`);
  return parts.join(' · ');
}

/**
 * What this facility has been billed, and what it still owes.
 *
 * The API has served a facility its own invoices since module 12, and the
 * dashboard drew a chart from them, but there was no page a finance officer
 * could open to answer the only question they bring: how much do we owe, and
 * for which shifts?
 *
 * So each invoice is its amount, its status in words and what it is waiting for, with the shifts
 * under it. A short invoice still to be paid opens with its shifts showing; a paid one, or a long
 * one, folds them away, and either can be changed with one tap. On a phone the shifts are a list rather than a seven-
 * column table.
 *
 * Drafts are left out. A draft is Medilink still putting the invoice
 * together — it can change, and showing it as a bill would be showing an
 * amount nobody has asked for yet.
 */
export default function FacilityInvoicesPage() {
  const facilityId = useFacilityId();

  // A page at a time, with the totals from the server: a sum over the rows on
  // screen would change as somebody paged, and this is the figure read as a debt.
  const invoices = useInfiniteQuery({
    queryKey: ['facility-invoices', facilityId],
    queryFn: ({ pageParam }) =>
      api.get<InvoicePage>(
        `/api/v1/invoices?facilityId=${facilityId}&billedOnly=true&limit=25${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(facilityId),
  });

  const billed = invoices.data?.pages.flatMap((page) => page.invoices) ?? [];
  const totals = invoices.data?.pages[0]?.totals;
  const owed = totals?.outstandingKobo ?? 0;
  const outstandingCount = totals?.outstandingCount ?? 0;
  const paid = totals?.paidKobo ?? 0;
  // Only a first load that failed hides the figures; a failed "older invoices" leaves them be.
  const failedToLoad = invoices.isError && !invoices.data;

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every invoice Medilink has issued to this facility, shift by shift, at the rate agreed when each was published and this facility's rate card."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <AmountFigure
          label="Outstanding"
          amountKobo={owed}
          hint={
            outstandingCount === 0
              ? 'Nothing waiting to be paid.'
              : `${outstandingCount} issued invoice${outstandingCount === 1 ? '' : 's'} not yet paid.`
          }
          isPending={invoices.isPending}
          isError={failedToLoad}
          emphasise
        />
        <AmountFigure
          label="Paid"
          amountKobo={paid}
          hint="Everything recorded as received, all time."
          isPending={invoices.isPending}
          isError={failedToLoad}
        />
      </div>

      {invoices.isPending ? (
        <ListSkeleton rows={2} label="Loading invoices" />
      ) : failedToLoad ? (
        <ErrorState
          error={invoices.error}
          onRetry={() => void invoices.refetch()}
          retrying={invoices.isFetching}
        />
      ) : billed.length === 0 ? (
        <EmptyState
          icon={<ReceiptText />}
          title="Nothing billed yet"
          description="An invoice covers approved shifts over a period. It appears here once Medilink issues it."
        />
      ) : (
        <>
          <ul className="space-y-4" aria-label="Invoices">
            {billed.map((invoice) => {
              const standing = whereItStands(invoice);
              const shifts = `${invoice.lines.length} shift${invoice.lines.length === 1 ? '' : 's'}`;
              return (
                <li key={invoice.id}>
                  <Card className="p-4 sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h2 className="font-mono text-base font-semibold [overflow-wrap:anywhere]">
                          {invoice.number}
                        </h2>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)} ·{' '}
                          {shifts}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                        <Money kobo={invoice.grossKobo} strong className="text-xl" />
                        <StatusBadge status={invoice.status} />
                      </div>
                    </div>

                    {standing ? <p className="mt-3 text-sm leading-relaxed">{standing}</p> : null}

                    {invoice.lines.length > 0 ? (
                      <details
                        className="group mt-3 border-t pt-1"
                        open={invoice.status !== 'PAID' && invoice.lines.length <= OPEN_UP_TO}
                      >
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md text-base font-medium [&::-webkit-details-marker]:hidden">
                          <span>
                            <span className="group-open:hidden">Show {shifts}</span>
                            <span className="hidden group-open:inline">Hide {shifts}</span>
                          </span>
                          <ChevronDown
                            className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                            aria-hidden="true"
                          />
                        </summary>

                        <div className="mt-2">
                          <div className="hidden md:block">
                            <Table>
                              <caption className="sr-only">
                                Shifts on invoice {invoice.number}
                              </caption>
                              <TableHeader>
                                <TableRow>
                                  <TableHead scope="col" className="px-3 text-sm">
                                    Practitioner
                                  </TableHead>
                                  <TableHead scope="col" className="px-3 text-sm">
                                    Ordinary
                                  </TableHead>
                                  <TableHead scope="col" className="px-3 text-sm">
                                    Night
                                  </TableHead>
                                  <TableHead scope="col" className="px-3 text-sm">
                                    Holiday
                                  </TableHead>
                                  <TableHead scope="col" className="px-3 text-right text-sm">
                                    Base
                                  </TableHead>
                                  <TableHead scope="col" className="px-3 text-right text-sm">
                                    Allowances
                                  </TableHead>
                                  <TableHead scope="col" className="px-3 text-right text-sm">
                                    Total
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {invoice.lines.map((line) => (
                                  <TableRow key={line.assignmentId}>
                                    <TableCell className="px-3 py-2.5 text-sm">
                                      {line.practitionerName}
                                    </TableCell>
                                    <TableCell className="px-3 py-2.5 text-sm">
                                      {formatMinutes(line.ordinaryMinutes)}
                                    </TableCell>
                                    <TableCell className="px-3 py-2.5 text-sm">
                                      {formatMinutes(line.nightMinutes)}
                                    </TableCell>
                                    <TableCell className="px-3 py-2.5 text-sm">
                                      {formatMinutes(line.holidayMinutes)}
                                    </TableCell>
                                    <TableCell className="px-3 py-2.5 text-right text-sm">
                                      <Money kobo={line.baseKobo} />
                                    </TableCell>
                                    <TableCell className="px-3 py-2.5 text-right text-sm">
                                      {line.premiumKobo > 0 ? (
                                        <Money kobo={line.premiumKobo} />
                                      ) : (
                                        '—'
                                      )}
                                    </TableCell>
                                    <TableCell className="px-3 py-2.5 text-right text-sm">
                                      <Money kobo={line.amountKobo} strong />
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>

                          <ul
                            className="divide-y md:hidden"
                            aria-label={`Shifts on invoice ${invoice.number}`}
                          >
                            {invoice.lines.map((line) => (
                              <li key={line.assignmentId} className="space-y-0.5 py-3">
                                <p className="flex items-baseline justify-between gap-3">
                                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                                    {line.practitionerName}
                                  </span>
                                  <Money kobo={line.amountKobo} strong />
                                </p>
                                <p className="text-sm text-muted-foreground">{hoursOf(line)}</p>
                                <p className="text-sm text-muted-foreground">
                                  <Money kobo={line.baseKobo} />
                                  {line.premiumKobo > 0 ? (
                                    <>
                                      {' + '}
                                      <Money kobo={line.premiumKobo} /> allowances
                                    </>
                                  ) : null}
                                </p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </details>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>

          {invoices.isFetchNextPageError ? (
            <p role="alert" className="mt-4 text-center text-sm text-destructive-text">
              Older invoices could not be loaded.
            </p>
          ) : null}
          {invoices.hasNextPage ? (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => void invoices.fetchNextPage()}
                loading={invoices.isFetchingNextPage}
              >
                {invoices.isFetchNextPageError ? 'Try again' : 'Show older invoices'}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
