'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { Banknote, Landmark, Wallet } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useCursorPager } from '@/lib/ui/cursor-pager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DataTable, type Column } from '@/components/app/data-table';
import { MetricTile } from '@/components/app/dashboard';
import { Field } from '@/components/app/field';
import { FilterBar } from '@/components/app/filter-bar';
import { Money } from '@/components/app/money';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { Pager } from '@/components/app/pager';
import { ErrorState, FilteredEmpty, TableSkeleton } from '@/components/app/states';
import { StatusBadge } from '@/components/app/status-badge';
import { ReconciliationCard } from './reconciliation-card';

const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PAID'] as const;
const PAGE_SIZE = 20;

/** Dates and amounts as /api/v1/dashboard/finance sends them: kobo, months as "2026-10". */
interface Summary {
  totals: { outstandingKobo: number; paidKobo: number; draftKobo: number; feesKobo: number };
  byMonth: { month: string; invoicedKobo: number; paidKobo: number }[];
  byFacility: { facilityId: string; name: string; outstandingKobo: number }[];
}

interface InvoiceRow {
  id: string;
  facilityName: string;
  number: string;
  grossKobo: number;
  platformFeeKobo: number;
  status: string;
}

/**
 * The money, across every facility.
 *
 * Two charts and four tiles, and no more than that. Most of what finance
 * needs to know here is a single number — what is outstanding — and a
 * headline is the honest form for a headline. The charts earn their place by
 * answering questions a number cannot: whether the outstanding balance is
 * growing, and where the money is sitting.
 */
/** The charting library loads after the tiles and navigation have drawn. */
const SpendChart = dynamic(
  () => import('@/components/app/money-charts').then((m) => m.SpendChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[260px] w-full" />,
  },
);
const OutstandingChart = dynamic(
  () => import('@/components/app/money-charts').then((m) => m.OutstandingChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[260px] w-full" />,
  },
);

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "2026-10" as "Oct 26". */
function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return `${SHORT_MONTHS[(month ?? 1) - 1]} ${String(year).slice(-2)}`;
}

export default function FinancePage() {
  // Everything above the table is one request, summed in the database. It used
  // to be one request per verified facility, added up in the browser.
  const summary = useQuery({
    queryKey: ['tile', 'finance-summary'],
    queryFn: () => api.get<Summary>('/api/v1/dashboard/finance'),
    retry: false,
  });

  const byMonth = useMemo(
    () =>
      (summary.data?.byMonth ?? []).map((row) => ({
        month: monthLabel(row.month),
        invoiced: row.invoicedKobo,
        paid: row.paidKobo,
      })),
    [summary.data],
  );

  /** Where the money is sitting right now: the largest balances, biggest first. */
  const byFacility = useMemo(
    () =>
      (summary.data?.byFacility ?? []).map((row) => ({
        name: row.name,
        outstanding: row.outstandingKobo,
      })),
    [summary.data],
  );

  // Filters and paging apply to the table only — the charts above answer "is
  // the whole picture healthy", and narrowing them to match a filter would
  // make them answer a different, smaller question without saying so.
  const [facilitySearch, setFacilitySearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | (typeof INVOICE_STATUSES)[number]>(
    'ALL',
  );
  const pager = useCursorPager();
  const { startOver } = pager;

  // Typing waits for a pause before it asks the server, so a name is one
  // request rather than one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(facilitySearch.trim());
      startOver();
    }, 300);
    return () => clearTimeout(timer);
  }, [facilitySearch, startOver]);

  const table = useQuery({
    queryKey: ['finance-invoices', statusFilter, appliedSearch, pager.cursor],
    queryFn: () => {
      const parts = [
        `limit=${PAGE_SIZE}`,
        statusFilter !== 'ALL' ? `status=${statusFilter}` : '',
        appliedSearch ? `search=${encodeURIComponent(appliedSearch)}` : '',
        pager.cursor ? `cursor=${pager.cursor}` : '',
      ].filter(Boolean);
      return api.get<{ invoices: InvoiceRow[]; nextCursor: string | null }>(
        `/api/v1/finance/invoices?${parts.join('&')}`,
      );
    },
    placeholderData: (previous) => previous,
    retry: false,
  });
  const pagedInvoices = table.data?.invoices ?? [];
  const nextCursor = table.data?.nextCursor ?? null;
  const activeCount = (statusFilter !== 'ALL' ? 1 : 0) + (appliedSearch !== '' ? 1 : 0);

  function clearFilters() {
    setFacilitySearch('');
    setAppliedSearch('');
    setStatusFilter('ALL');
    startOver();
  }

  const totals = summary.data?.totals;
  const tiles = [
    {
      label: 'Outstanding',
      kobo: totals?.outstandingKobo,
      icon: Landmark,
      hint: 'Issued and not yet paid.',
    },
    { label: 'Paid', kobo: totals?.paidKobo, icon: Banknote, hint: 'Settled in full.' },
    {
      label: 'In draft',
      kobo: totals?.draftKobo,
      icon: Wallet,
      hint: 'Raised but not yet issued to anybody.',
    },
    {
      label: 'Platform fees',
      kobo: totals?.feesKobo,
      icon: Wallet,
      hint: 'Zero until the revenue model is settled.',
    },
  ];

  const columns: Column<InvoiceRow>[] = [
    {
      id: 'number',
      header: 'Number',
      role: 'identity',
      cell: (row) => <span className="font-mono text-sm">{row.number}</span>,
    },
    { id: 'facility', header: 'Facility', cell: (row) => row.facilityName },
    {
      id: 'status',
      header: 'Status',
      role: 'status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: 'gross',
      header: 'Gross',
      align: 'right',
      numeric: true,
      cell: (row) => <Money kobo={row.grossKobo} />,
    },
    {
      id: 'fee',
      header: 'Platform fee',
      align: 'right',
      numeric: true,
      cell: (row) => <Money kobo={row.platformFeeKobo} className="text-muted-foreground" />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Finance"
        description="Every invoice across every verified facility. Figures are what the ledger says, summed from its entries rather than stored anywhere."
      />

      {/* A failed summary says so on each figure: "could not load" is not ₦0.00. */}
      {/* Two across until there is room for four full-width figures: a seven-figure amount with
          kobo does not fit in a quarter of a laptop screen without breaking in the middle. */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 sm:gap-4 2xl:grid-cols-4">
        {tiles.map((tile) => (
          <MetricTile
            key={tile.label}
            label={tile.label}
            icon={tile.icon}
            value={<Money kobo={tile.kobo ?? 0} />}
            hint={tile.hint}
            loading={summary.isPending}
            error={summary.isError}
          />
        ))}
      </div>
      {summary.isError ? (
        <div className="-mt-2 mb-6">
          <ErrorState
            compact
            error={summary.error}
            onRetry={() => void summary.refetch()}
            retrying={summary.isFetching}
          />
        </div>
      ) : null}

      <ReconciliationCard />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoiced and paid</CardTitle>
            <CardDescription>By the month the work was done, in naira.</CardDescription>
          </CardHeader>
          <CardContent>
            {summary.isPending ? (
              <Skeleton className="h-[260px] w-full" />
            ) : summary.isError ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                The figures could not be loaded, so there is nothing to draw.
              </p>
            ) : byMonth.length === 0 ? (
              <p className="py-20 text-center text-sm text-muted-foreground">
                Nothing invoiced yet.
              </p>
            ) : (
              <>
                <SpendChart data={byMonth} height={260} yAxisWidth={56} legend={false} />
                <FiguresAsTable
                  caption="Invoiced and paid, by month"
                  head={['Month', 'Invoiced', 'Paid']}
                  rows={byMonth.map((row) => [
                    row.month,
                    <Money key="i" kobo={row.invoiced} />,
                    <Money key="p" kobo={row.paid} />,
                  ])}
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Who owes what</CardTitle>
            <CardDescription>Outstanding by facility, largest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {summary.isPending ? (
              <Skeleton className="h-[260px] w-full" />
            ) : summary.isError ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                The figures could not be loaded, so there is nothing to draw.
              </p>
            ) : byFacility.length === 0 ? (
              <p className="py-20 text-center text-sm text-muted-foreground">
                Nothing outstanding. Every issued invoice has been paid.
              </p>
            ) : (
              <>
                <OutstandingChart data={byFacility} />
                <FiguresAsTable
                  caption="Outstanding, by facility"
                  head={['Facility', 'Outstanding']}
                  rows={byFacility.map((row) => [
                    row.name,
                    <Money key="o" kobo={row.outstanding} />,
                  ])}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="every-invoice" className="mt-8">
        <h2 id="every-invoice" className="text-lg font-semibold">
          Every invoice
        </h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Filters here narrow this list only, not the figures and charts above.
        </p>

        <FilterBar
          searchLabel="Facility"
          searchPlaceholder="Search by facility name"
          searchValue={facilitySearch}
          onSearchChange={setFacilitySearch}
          activeCount={activeCount}
          onClear={clearFilters}
          busy={table.isFetching && !table.isPending}
          summary={
            !table.isPending && pagedInvoices.length > 0
              ? `${pagedInvoices.length} on this page`
              : undefined
          }
        >
          <Field label="Status" className="md:w-44">
            {(a11y) => (
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as typeof statusFilter);
                  startOver();
                }}
              >
                <SelectTrigger {...a11y}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Any status</SelectItem>
                  {INVOICE_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.charAt(0) + status.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </FilterBar>

        {table.isPending ? (
          <TableSkeleton label="Loading invoices" columns={5} />
        ) : table.isError && !table.data ? (
          <ErrorState
            error={table.error}
            onRetry={() => void table.refetch()}
            retrying={table.isFetching}
          />
        ) : pagedInvoices.length === 0 ? (
          activeCount > 0 ? (
            <FilteredEmpty noun="invoices" activeCount={activeCount} onClear={clearFilters} />
          ) : (
            <EmptyState
              icon={<Landmark />}
              title="No invoices have been raised"
              description="Invoices are raised from shifts a facility has approved. They appear here once one is."
            />
          )
        ) : (
          <DataTable
            caption="Invoices across every facility"
            rows={pagedInvoices}
            columns={columns}
            getKey={(row) => row.id}
          />
        )}

        <Pager
          pageIndex={pager.pageIndex}
          hasNext={Boolean(nextCursor)}
          busy={table.isFetching}
          onPrevious={pager.goPrevious}
          onNext={() => pager.goNext(nextCursor)}
        />
      </section>

      {/* Kept off the charts and said once, plainly. */}
      <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
        Platform fees read zero because the revenue model has not been settled. The account, the
        arithmetic and the column all exist — only the rate is unset, and setting it is
        configuration rather than a change to any of this.
      </p>
    </>
  );
}

/**
 * The numbers behind a chart, as words and a table.
 *
 * A bar chart is a picture of a table. Behind a disclosure so it costs nothing to look at, and
 * there for anyone who cannot see the bars, cannot tell two hues apart, or wants a figure to the
 * kobo rather than an axis tick rounded to the nearest thousand.
 */
function FiguresAsTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <details className="group mt-3 border-t pt-1">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
        Show these figures as a table
      </summary>
      <div className="overflow-x-auto pb-1">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              {head.map((label, index) => (
                <TableHead key={label} scope="col" className={index > 0 ? 'text-right' : undefined}>
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((cells, rowIndex) => (
              <TableRow key={rowIndex}>
                {cells.map((cell, index) => (
                  <TableCell key={index} className={index > 0 ? 'tabular text-right' : undefined}>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </details>
  );
}
