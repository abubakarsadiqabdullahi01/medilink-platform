'use client';

import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  XAxis,
  YAxis,
} from 'recharts';
import { Banknote, ChevronLeft, ChevronRight, Landmark, TriangleAlert, Wallet } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
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
import { PageHeader } from '@/components/app/page-shell';
import { formatNaira } from '@/components/app/format';

const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PAID'] as const;
const PAGE_SIZE = 20;

interface FacilitySummary {
  id: string;
  name: string;
  status: string;
}

interface Invoice {
  id: string;
  facilityId: string;
  number: string;
  grossKobo: number;
  platformFeeKobo: number;
  status: string;
  issuedAt: string | null;
  paidAt: string | null;
  periodStart: string;
  lines: { amountKobo: number }[];
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
const CHART_CONFIG = {
  invoiced: { label: 'Invoiced', color: 'hsl(var(--chart-1))' },
  paid: { label: 'Paid', color: 'hsl(var(--chart-2))' },
} satisfies ChartConfig;

/** Kobo on the axis would be six digits of noise; naira is what people say. */
const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;

function monthKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    month: 'short',
    year: '2-digit',
  });
}

export default function FinancePage() {
  const facilities = useQuery({
    queryKey: ['finance-facilities'],
    queryFn: () =>
      api.get<{ facilities: FacilitySummary[] }>(
        '/api/v1/facilities?scopeType=PLATFORM&status=VERIFIED',
      ),
  });

  // Memoised because it feeds a useMemo below: a fresh array literal on every
  // render would recompute the facility breakdown on every render too.
  const verified = useMemo(() => facilities.data?.facilities ?? [], [facilities.data]);

  // One request per facility: there is no cross-facility invoice endpoint,
  // and inventing one to save a few requests in a pilot would be a second
  // thing to keep true.
  const invoiceQueries = useQueries({
    queries: verified.map((facility) => ({
      queryKey: ['invoices', facility.id],
      queryFn: () =>
        api.get<{ invoices: Invoice[] }>(`/api/v1/invoices?facilityId=${facility.id}`),
      retry: false,
    })),
  });

  const invoices = useMemo(
    () => invoiceQueries.flatMap((result) => result.data?.invoices ?? []),
    [invoiceQueries],
  );

  const loading = facilities.isPending || invoiceQueries.some((result) => result.isPending);

  const totals = useMemo(() => {
    const outstanding = invoices
      .filter((row) => row.status === 'ISSUED')
      .reduce((sum, row) => sum + row.grossKobo, 0);
    const paid = invoices
      .filter((row) => row.status === 'PAID')
      .reduce((sum, row) => sum + row.grossKobo, 0);
    const draft = invoices
      .filter((row) => row.status === 'DRAFT')
      .reduce((sum, row) => sum + row.grossKobo, 0);
    const fees = invoices.reduce((sum, row) => sum + row.platformFeeKobo, 0);
    return { outstanding, paid, draft, fees };
  }, [invoices]);

  /** Invoiced against paid, by the month the work was done. */
  const byMonth = useMemo(() => {
    const buckets = new Map<string, { month: string; invoiced: number; paid: number }>();
    for (const row of invoices) {
      const key = monthKey(row.periodStart);
      const bucket = buckets.get(key) ?? { month: key, invoiced: 0, paid: 0 };
      bucket.invoiced += row.grossKobo;
      if (row.status === 'PAID') bucket.paid += row.grossKobo;
      buckets.set(key, bucket);
    }
    return [...buckets.values()];
  }, [invoices]);

  /** Where the money is sitting right now, by facility. */
  const byFacility = useMemo(() => {
    const rows = verified.map((facility) => ({
      name: facility.name,
      outstanding: invoices
        .filter((row) => row.facilityId === facility.id && row.status === 'ISSUED')
        .reduce((sum, row) => sum + row.grossKobo, 0),
    }));
    return rows.filter((row) => row.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);
  }, [verified, invoices]);

  // Filters and paging apply to the table only — the charts above answer "is
  // the whole picture healthy", and narrowing them to match a filter would
  // make them answer a different, smaller question without saying so.
  const [facilitySearch, setFacilitySearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | (typeof INVOICE_STATUSES)[number]>('ALL');
  const [page, setPage] = useState(1);

  const facilityNames = useMemo(
    () => new Map(verified.map((facility) => [facility.id, facility.name])),
    [verified],
  );

  const filteredInvoices = useMemo(() => {
    const search = facilitySearch.trim().toLowerCase();
    return invoices.filter((row) => {
      if (statusFilter !== 'ALL' && row.status !== statusFilter) return false;
      const name = facilityNames.get(row.facilityId) ?? '';
      if (search && !name.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [invoices, facilitySearch, statusFilter, facilityNames]);

  // Clamped at read time rather than reset in an effect: a filter that
  // shrinks the result set should not fight the page number for who updates
  // first.
  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedInvoices = filteredInvoices.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

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

      <div className="grid gap-4 lg:grid-cols-2">
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
              <ChartContainer config={CHART_CONFIG} className="h-[260px] w-full">
                <BarChart data={byMonth} accessibilityLayer>
                  {/* Horizontal only: vertical rules add ink and answer
                      nothing a categorical axis has not already said. */}
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    width={72}
                    tickFormatter={naira}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent formatter={(value) => naira(Number(value))} />}
                  />
                  {/* 2px surface gap between adjacent bars, and rounded
                      data-ends anchored to the baseline. */}
                  <Bar dataKey="invoiced" fill="var(--color-invoiced)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="paid" fill="var(--color-paid)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
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
              /* One series, so one hue and no legend — the facility names on
                 the axis carry the identity, not the colour. */
              <ChartContainer
                config={{ outstanding: { label: 'Outstanding', color: 'hsl(var(--chart-1))' } }}
                className="h-[260px] w-full"
              >
                <BarChart data={byFacility} layout="vertical" accessibilityLayer>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={naira} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    width={140}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent formatter={(value) => naira(Number(value))} />}
                  />
                  <Bar dataKey="outstanding" radius={[0, 4, 4, 0]}>
                    {byFacility.map((row) => (
                      <Cell key={row.name} fill="var(--color-outstanding)" />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
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
          {facilities.isError ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>Facilities could not be loaded.</AlertDescription>
            </Alert>
          ) : loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))}
            </div>
          ) : invoices.length === 0 ? (
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
                    onChange={(event) => {
                      setFacilitySearch(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Search by facility name…"
                  />
                </div>
                <div className="w-40 space-y-1.5">
                  <Label>Status</Label>
                  <Select
                    value={statusFilter}
                    onValueChange={(value) => {
                      setStatusFilter(value as typeof statusFilter);
                      setPage(1);
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

              {filteredInvoices.length === 0 ? (
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
                          <TableCell>{facilityNames.get(row.facilityId) ?? '—'}</TableCell>
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
                      {(safePage - 1) * PAGE_SIZE + 1}–
                      {Math.min(safePage * PAGE_SIZE, filteredInvoices.length)} of{' '}
                      {filteredInvoices.length}
                    </p>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={safePage <= 1}
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                      >
                        <ChevronLeft />
                        Previous
                      </Button>
                      <p className="tabular text-xs text-muted-foreground">
                        Page {safePage} of {totalPages}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={safePage >= totalPages}
                        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
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
