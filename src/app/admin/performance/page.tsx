'use client';

import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ui/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

/** The targets the system is held to: normal routes under 300 ms at the 95th percentile. */
const TARGET_MS = 300;

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
          <Button variant="outline" onClick={() => void report.refetch()} loading={report.isFetching}>
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
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <p className="mb-3 text-xs text-muted-foreground">
              Since {formatWhen(report.data.since)}. Rows over {TARGET_MS} ms at the 95th percentile
              are marked.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Route</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">p50</TableHead>
                  <TableHead className="text-right">p95</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead className="text-right">DB ms</TableHead>
                  <TableHead className="text-right">Queries</TableHead>
                  <TableHead className="text-right">KB</TableHead>
                  <TableHead className="text-right">Slow</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.routes.map((row) => (
                  <TableRow key={row.route}>
                    <TableCell className="font-mono text-xs">{row.route}</TableCell>
                    <TableCell className="tabular text-right">{row.count}</TableCell>
                    <TableCell className="tabular text-right">{row.p50Ms}</TableCell>
                    <TableCell
                      className={cn(
                        'tabular text-right',
                        row.p95Ms > TARGET_MS && 'font-medium text-warning',
                      )}
                    >
                      {row.p95Ms}
                    </TableCell>
                    <TableCell className="tabular text-right">{row.maxMs}</TableCell>
                    <TableCell className="tabular text-right">{row.meanDbMs}</TableCell>
                    <TableCell
                      className={cn('tabular text-right', row.meanQueries > 25 && 'font-medium text-warning')}
                    >
                      {row.meanQueries}
                    </TableCell>
                    <TableCell className="tabular text-right">{row.meanKb}</TableCell>
                    <TableCell className="tabular text-right">{row.slow || ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
