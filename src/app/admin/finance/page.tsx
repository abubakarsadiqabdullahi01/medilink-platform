'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { Banknote, ChevronLeft, ChevronRight, Landmark, Wallet } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { PageHeader, ErrorState } from '@/components/app/page-shell';
import { formatNaira } from '@/components/app/format';
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
const SpendChart = dynamic(() => import('@/components/app/money-charts').then((m) => m.SpendChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full" />,
});
const OutstandingChart = dynamic(() => import('@/components/app/money-charts').then((m) => m.OutstandingChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full" />,
});

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  const loading = summary.isPending;

  const totals = {
    outstanding: summary.data?.totals.outstandingKobo ?? 0,
    paid: summary.data?.totals.paidKobo ?? 0,
    draft: summary.data?.totals.draftKobo ?? 0,
    fees: summary.data?.totals.feesKobo ?? 0,
  };

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
  const [statusFilter, setStatusFilter] = useState<'ALL' | (typeof INVOICE_STATUSES)[number]>('ALL');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);

  // Typing waits for a pause before it asks the server, so a name is one
  // request rather than one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(facilitySearch.trim());
      setCursors([null]);
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [facilitySearch]);

  const cursor = cursors[pageIndex] ?? null;
  const table = useQuery({
    queryKey: ['finance-invoices', statusFilter, appliedSearch, cursor],
    queryFn: () => {
      const parts = [
        `limit=${PAGE_SIZE}`,
        statusFilter !== 'ALL' ? `status=${statusFilter}` : '',
        appliedSearch ? `search=${encodeURIComponent(appliedSearch)}` : '',
        cursor ? `cursor=${cursor}` : '',
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
  const filtered = statusFilter !== 'ALL' || appliedSearch !== '';

  const tiles = [
    {
      label: 'Outstanding',
      value: totals.outstanding,
      icon: Landmark,
      hint: 'Issued and not yet paid.',
    },
    { label: 'Paid', value: totals.paid, icon: Banknote, hint: 'Settled in full.' },
    {
      label: 'In draft',
      value: totals.draft,
      icon: Wallet,
      hint: 'Raised but not yet issued to anybody.',
    },
    {
      label: 'Platform fees',
      value: totals.fees,
      icon: Wallet,
      hint: 'Zero until the revenue model is settled.',
    },
  ];

  return (
    <>
      <PageHeader
        title="Finance"
        description="Every invoice across every verified facility. Figures are what the ledger says, summed from its entries rather than stored anywhere."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Card key={tile.label}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{tile.label}</CardTitle>
                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <p className="tabular text-2xl font-semibold">{formatNaira(tile.value)}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">{tile.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ReconciliationCard />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoiced and paid</CardTitle>
            <CardDescription>By the month the work was done, in naira.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : byMonth.length === 0 ? (
              <p className="py-20 text-center text-sm text-muted-foreground">
                Nothing invoiced yet.
              </p>
            ) : (
              <SpendChart data={byMonth} height={260} yAxisWidth={80} legend={false} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Who owes what</CardTitle>
            <CardDescription>Outstanding by facility, largest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : byFacility.length === 0 ? (
              <p className="py-20 text-center text-sm text-muted-foreground">
                Nothing outstanding. Every issued invoice has been paid.
              </p>
            ) : (
              <OutstandingChart data={byFacility} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Every invoice</CardTitle>
          <CardDescription>
            The same figures as the charts above, readable without colour.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.isError || table.isError ? (
        <ErrorState message="The invoices could not be loaded." onRetry={() => void table.refetch()} retrying={table.isFetching} />
      ) : table.isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))}
            </div>
          ) : pagedInvoices.length === 0 && !filtered && pageIndex === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No invoices have been raised.
            </p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div className="min-w-[220px] flex-1 space-y-1.5">
                  <Label htmlFor="invoice-facility-search">Facility</Label>
                  <Input
                    id="invoice-facility-search"
                    value={facilitySearch}
                    onChange={(event) => setFacilitySearch(event.target.value)}
                    placeholder="Search by facility name…"
                  />
                </div>
                <div className="w-40 space-y-1.5">
                  <Label>Status</Label>
                  <Select
                    value={statusFilter}
                    onValueChange={(value) => {
                      setStatusFilter(value as typeof statusFilter);
                      setCursors([null]);
                      setPageIndex(0);
                    }}
                  >
                    <SelectTrigger>
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
                </div>
              </div>

              {pagedInvoices.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No invoice matches that facility and status.
                </p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Number</TableHead>
                        <TableHead>Facility</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right">Fee</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedInvoices.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono text-xs">{row.number}</TableCell>
                          <TableCell>{row.facilityName}</TableCell>
                          <TableCell className="text-xs">{row.status}</TableCell>
                          <TableCell className="tabular text-right">
                            {formatNaira(row.grossKobo)}
                          </TableCell>
                          <TableCell className="tabular text-right text-muted-foreground">
                            {formatNaira(row.platformFeeKobo)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {pagedInvoices.length} on this page
                    </p>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pageIndex === 0}
                        onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                      >
                        <ChevronLeft />
                        Previous
                      </Button>
                      <p className="tabular text-xs text-muted-foreground">Page {pageIndex + 1}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!nextCursor}
                        onClick={() => {
                          setCursors((current) => [...current.slice(0, pageIndex + 1), nextCursor]);
                          setPageIndex((current) => current + 1);
                        }}
                      >
                        Next
                        <ChevronRight />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Kept off the charts and said once, plainly. */}
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Platform fees read zero because the revenue model has not been settled. The account, the
        arithmetic and the column all exist — only the rate is unset, and setting it is
        configuration rather than a change to any of this.
      </p>
    </>
  );
}
