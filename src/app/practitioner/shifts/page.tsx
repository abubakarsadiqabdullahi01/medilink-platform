'use client';

import { useState } from 'react';
import { CalendarCheck, TriangleAlert } from 'lucide-react';
import { useQueue } from '@/lib/ui/queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatAgo, formatNaira, formatWhen } from '@/components/app/format';
import { CheckInPanel } from './check-in-panel';

interface Assignment {
  id: string;
  serviceRequestId: string;
  facilityId: string;
  facilityName: string;
  shiftType: string;
  hourlyRateKobo: number;
  status: string;
  startsAt: string;
  endsAt: string;
}

const STATUSES = ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;

export default function MyShiftsPage() {
  const [status, setStatus] = useState<string>('CONFIRMED');

  const queue = useQueue<Assignment>(
    ['my-shifts', status],
    `/api/v1/assignments?scopeType=SELF&status=${status}`,
    (body) => (body as { assignments?: Assignment[] }).assignments ?? [],
  );

  const rows = [...(queue.data ?? [])].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  return (
    <>
      <PageHeader
        title="My shifts"
        description="Confirmed shifts, soonest first. Check in when you arrive using the code the ward gives you."
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
          <AlertDescription>Your shifts could not be loaded.</AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck />}
          title={`Nothing ${status.toLowerCase().replace('_', ' ')}`}
          description={
            status === 'CONFIRMED'
              ? 'A shift appears here once a facility confirms you onto it.'
              : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                <div className="min-w-0">
                  <p className="font-medium">{formatWhen(row.startsAt)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(row.startsAt) <= new Date() ? 'started' : 'starts'}{' '}
                    {formatAgo(row.startsAt)}
                  </p>
                </div>
                <StatusBadge status={row.status} />
              </CardHeader>

              <CardContent className="space-y-4">
                <DetailGrid>
                  <Detail label="Ends">{formatWhen(row.endsAt)}</Detail>
                  <Detail label="Facility">{row.facilityName}</Detail>
                  <Detail label="Type">{humanise(row.shiftType)}</Detail>
                  <Detail label="Rate">{formatNaira(row.hourlyRateKobo)}/hour</Detail>
                </DetailGrid>

                {row.status === 'CONFIRMED' ? (
                  <>
                    <Separator />
                    <CheckInPanel assignmentId={row.id} />
                  </>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
