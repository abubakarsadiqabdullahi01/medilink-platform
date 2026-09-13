'use client';

import { useState } from 'react';
import { Building2, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useQueue, useQueueAction } from '@/lib/ui/queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatAgo, formatDate } from '@/components/app/format';

interface Facility {
  id: string;
  name: string;
  cacNumber: string;
  status: string;
  addressLine: string;
  contactPhone: string;
  contactEmail: string | null;
  licenceNumber: string | null;
  licenceExpiresAt: string | null;
  createdAt: string;
}

const STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;

/** Facility verification — step 5.10. */
export default function FacilitiesPage() {
  const [status, setStatus] = useState<string>('PENDING');
  const queueKey = ['facilities', status];
  const queue = useQueue<Facility>(
    queueKey,
    `/api/v1/facilities?scopeType=PLATFORM&status=${status}`,
    (body) => (body as { facilities?: Facility[] }).facilities ?? [],
  );

  const [notes, setNotes] = useState<Record<string, string>>({});

  const verify = useQueueAction<{ id: string; decision: 'approve' | 'reject' }>({
    queueKey,
    run: ({ id, decision }) =>
      api.post(`/api/v1/facilities/${id}/verify`, {
        decision,
        reviewNotes: notes[id]?.trim() || undefined,
      }),
    success: ({ decision }) => (decision === 'approve' ? 'Facility verified' : 'Facility rejected'),
  });

  return (
    <>
      <PageHeader
        title="Facilities"
        description="A facility cannot publish a shift until it is verified — and changing the licence of a verified one sends it straight back to this queue."
      />

      <Tabs value={status} onValueChange={setStatus} className="mb-5">
        <TabsList>
          {STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {value.toLowerCase()}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {queue.isPending ? (
        <QueueSkeleton />
      ) : queue.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>This queue could not be loaded.</AlertDescription>
        </Alert>
      ) : queue.data.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={`No ${status.toLowerCase()} facilities`}
          description={
            status === 'PENDING'
              ? 'Operations onboards a facility and it appears here for verification.'
              : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {queue.data.map((row) => {
            const note = notes[row.id]?.trim() ?? '';
            const lapsed =
              row.licenceExpiresAt !== null && new Date(row.licenceExpiresAt) < new Date();

            return (
              <Card key={row.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                  <div className="min-w-0">
                    <p className="font-medium">{row.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {row.cacNumber} · onboarded {formatAgo(row.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={row.status} />
                </CardHeader>

                <CardContent className="space-y-4">
                  <DetailGrid>
                    <Detail label="Address" className="sm:col-span-2">
                      {row.addressLine}
                    </Detail>
                    <Detail label="Telephone">{row.contactPhone}</Detail>
                    <Detail label="Email">{row.contactEmail ?? '—'}</Detail>
                    <Detail label="Licence">{row.licenceNumber ?? 'Not given'}</Detail>
                    <Detail label="Licence expires">{formatDate(row.licenceExpiresAt)}</Detail>
                  </DetailGrid>

                  {lapsed ? (
                    <Alert variant="warning">
                      <TriangleAlert />
                      <AlertDescription>
                        This licence has already expired. Verifying it now would let the facility
                        publish shifts on a lapsed licence.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {row.status === 'PENDING' ? (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Label htmlFor={`notes-${row.id}`}>
                          Reason{' '}
                          <span className="font-normal text-muted-foreground">
                            — required to reject
                          </span>
                        </Label>
                        <Textarea
                          id={`notes-${row.id}`}
                          rows={2}
                          placeholder="What could not be confirmed."
                          value={notes[row.id] ?? ''}
                          onChange={(event) =>
                            setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                          }
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="success"
                          loading={verify.isPending && verify.variables?.id === row.id}
                          onClick={() => verify.mutate({ id: row.id, decision: 'approve' })}
                        >
                          Verify
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!note || verify.isPending}
                          onClick={() => verify.mutate({ id: row.id, decision: 'reject' })}
                        >
                          Reject
                        </Button>
                      </div>
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
