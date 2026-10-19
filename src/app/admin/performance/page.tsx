'use client';

import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ui/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, type Column } from '@/components/app/data-table';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
import { formatWhen } from '@/components/app/format';

interface Report {
  since: string;
  routes: {
    route: string;
    count: number;
    slow: number;
    errors: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    meanDbMs: number;
    meanQueries: number;
    meanKb: number;
  }[];
}

type Row = Report['routes'][number];

/** The targets the system is held to: normal routes under 300 ms at the 95th percentile. */
const TARGET_MS = 300;
const TARGET_QUERIES = 25;

/** Over either target, in words as well as colour. */
const overTarget = (row: Row) => row.p95Ms > TARGET_MS || row.meanQueries > TARGET_QUERIES;

const columns: Column<Row>[] = [
  {
    id: 'route',
    header: 'Route',
    role: 'identity',
    cell: (row) => <span className="font-mono text-base">{row.route}</span>,
  },
  {
    id: 'target',
    header: 'Against target',
    role: 'status',
    cell: (row) =>
      overTarget(row) ? (
        <Badge variant="warning">Over target</Badge>
      ) : (
        <Badge variant="secondary">Within target</Badge>
      ),
  },
  { id: 'calls', header: 'Calls', align: 'right', numeric: true, cell: (row) => row.count },
  { id: 'p50', header: 'p50 ms', align: 'right', numeric: true, cell: (row) => row.p50Ms },
  {
    id: 'p95',
    header: 'p95 ms',
    align: 'right',
    numeric: true,
    cell: (row) => (
      <span className={cn(row.p95Ms > TARGET_MS && 'font-medium text-warning')}>{row.p95Ms}</span>
    ),
  },
  { id: 'max', header: 'Max ms', align: 'right', numeric: true, cell: (row) => row.maxMs },
  { id: 'db', header: 'DB ms', align: 'right', numeric: true, cell: (row) => row.meanDbMs },
  {
    id: 'queries',
    header: 'Queries',
    align: 'right',
    numeric: true,
    cell: (row) => (
      <span className={cn(row.meanQueries > TARGET_QUERIES && 'font-medium text-warning')}>
        {row.meanQueries}
      </span>
    ),
  },
  { id: 'kb', header: 'KB', align: 'right', numeric: true, cell: (row) => row.meanKb },
  { id: 'slow', header: 'Slow', align: 'right', numeric: true, cell: (row) => row.slow || '—' },
];

/**
 * Which routes are slow, from real traffic.
 *
 * Every request records its time, how much of it was the database and how many
 * queries it took. Read it with the shape of the problem in mind: a high query
 * count with a low time per query is a loop that should be one query; a low
 * count with a high time is a query that needs an index. Resets when the server
 * restarts.
 */
export default function PerformancePage() {
  const report = useQuery({
    queryKey: ['performance'],
    queryFn: () => api.get<Report>('/api/v1/admin/performance'),
    refetchInterval: 15_000,
  });

  return (
    <>
      <PageHeader
        title="Performance"
        description="How long each route takes, slowest first, from the requests this server has handled since it started. Each response also carries a Server-Timing header you can read in the browser's network panel."
        action={
          <Button
            variant="outline"
            onClick={() => void report.refetch()}
            loading={report.isFetching}
          >
            Refresh
          </Button>
        }
      />

      {report.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : report.isError ? (
        <ErrorState
          error={report.error}
          onRetry={() => void report.refetch()}
          retrying={report.isFetching}
        />
      ) : report.data.routes.length === 0 ? (
        <EmptyState
          icon={<Gauge />}
          title="Nothing measured yet"
          description="Use the system and the routes it calls appear here."
        />
      ) : (
        <>
          <p className="mb-3 text-base text-muted-foreground">
            Since {formatWhen(report.data.since)}. Rows over {TARGET_MS} ms at the 95th percentile,
            or over {TARGET_QUERIES} queries a call, say so.
          </p>
          <DataTable
            caption="Routes by time taken"
            rows={report.data.routes}
            columns={columns}
            getKey={(row) => row.route}
            rowTone={(row) => (overTarget(row) ? 'warning' : undefined)}
          />
        </>
      )}
    </>
  );
}
