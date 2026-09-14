'use client';

import { useState } from 'react';
import { TriangleAlert, Users } from 'lucide-react';
import { useFacilityId } from '@/lib/ui/facility';
import { useQueue } from '@/lib/ui/queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatAgo, formatWhen, shortId } from '@/components/app/format';
import { AttendancePanel } from './attendance-panel';

interface Assignment {
  id: string;
  serviceRequestId: string;
  userId: string;
  facilityId: string;
  status: string;
  startsAt: string;
  endsAt: string;
}

const STATUSES = ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;

/**
 * Who is due on the floor, and what happened when they got there.
 *
 * Sorted by start time so the next shift is the first thing read — a roster
 * ordered by when a row was created is a roster nobody uses at 6am.
 */
export default function RosterPage() {
  const facilityId = useFacilityId();
  const [status, setStatus] = useState<string>('CONFIRMED');

  const queue = useQueue<Assignment>(
    ['roster', facilityId, status],
    `/api/v1/assignments?scopeType=FACILITY&scopeId=${facilityId}&status=${status}`,
    (body) => (body as { assignments?: Assignment[] }).assignments ?? [],
  );

  const rows = [...(queue.data ?? [])].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  return (
    <>
      <PageHeader
        title="Roster"
        description="Confirmed shifts, and the attendance behind them. The facility issues a code and the practitioner presents it — that direction is what makes it evidence rather than proof somebody owns a phone."
      />

      <Tabs value={status} onValueChange={setStatus} className="mb-5">
        <TabsList>
          {STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {value.toLowerCase().replace('_', ' ')}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {queue.isPending ? (
        <QueueSkeleton />
      ) : queue.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>The roster could not be loaded.</AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={`Nothing ${status.toLowerCase().replace('_', ' ')}`}
          description={
            status === 'CONFIRMED'
              ? 'Confirm somebody onto a published shift and they appear here.'
              : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const started = new Date(row.startsAt) <= new Date();

            return (
              <Card key={row.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium">{shortId(row.userId)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatWhen(row.startsAt)} · {started ? 'started' : 'starts'}{' '}
                      {formatAgo(row.startsAt)}
                    </p>
                  </div>
                  <StatusBadge status={row.status} />
                </CardHeader>

                <CardContent className="space-y-4">
                  <DetailGrid>
                    <Detail label="Starts">{formatWhen(row.startsAt)}</Detail>
                    <Detail label="Ends">{formatWhen(row.endsAt)}</Detail>
                    <Detail label="Shift">{shortId(row.serviceRequestId)}</Detail>
                  </DetailGrid>

                  {row.status === 'CONFIRMED' && facilityId ? (
                    <>
                      <Separator />
                      <AttendancePanel assignmentId={row.id} facilityId={facilityId} />
                    </>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
