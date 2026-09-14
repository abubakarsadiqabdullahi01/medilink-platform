'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, TriangleAlert, Users } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { useQueue, useQueueAction } from '@/lib/ui/queue';
import { nameOf, useReference } from '@/lib/ui/reference';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatNaira, formatWhen } from '@/components/app/format';
import { NewShiftDialog } from './new-shift-dialog';

interface ServiceRequest {
  id: string;
  facilityId: string;
  professionalCategoryId: string;
  specialtyId: string | null;
  shiftType: string;
  startsAt: string;
  endsAt: string;
  headcount: number;
  confirmedCount?: number;
  hourlyRateKobo: number;
  urgency: string;
  status: string;
  cancellationTerms: string;
  notes: string | null;
}

const STATUSES = ['PUBLISHED', 'FILLED', 'DRAFT', 'CANCELLED', 'EXPIRED'] as const;

/** Module 6 — service requests, from the facility's side. */
export default function ShiftsPage() {
  const facilityId = useFacilityId();
  const reference = useReference();
  const [status, setStatus] = useState<string>('PUBLISHED');
  const [cancelling, setCancelling] = useState<ServiceRequest | null>(null);
  const [reason, setReason] = useState('');

  const queueKey = ['shifts', facilityId, status];
  const queue = useQueue<ServiceRequest>(
    queueKey,
    `/api/v1/service-requests?scopeType=FACILITY&scopeId=${facilityId}&status=${status}`,
    (body) => (body as { requests?: ServiceRequest[] }).requests ?? [],
  );

  const cancel = useQueueAction<{ id: string }>({
    queueKey,
    run: ({ id }) =>
      api.post(`/api/v1/service-requests/${id}/cancel`, { facilityId, reason: reason.trim() }),
    success: 'Shift cancelled',
  });

  const hoursOf = (row: ServiceRequest) =>
    (new Date(row.endsAt).getTime() - new Date(row.startsAt).getTime()) / 3_600_000;

  return (
    <>
      <PageHeader
        title="Shifts"
        description="A published shift can be offered to practitioners. Its terms cannot be changed after publishing — cancel it and publish another instead, so nobody accepts one thing and works another."
        action={facilityId ? <NewShiftDialog facilityId={facilityId} /> : null}
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
          <AlertDescription>These shifts could not be loaded.</AlertDescription>
        </Alert>
      ) : queue.data.length === 0 ? (
        <EmptyState
          icon={<CalendarPlus />}
          title={`No ${status.toLowerCase()} shifts`}
          description={
            status === 'PUBLISHED'
              ? 'Publish one and it becomes available to match against.'
              : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {queue.data.map((row) => {
            const filled = row.confirmedCount ?? 0;
            const hours = hoursOf(row);

            return (
              <Card key={row.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {nameOf(reference.data?.professionalCategories, row.professionalCategoryId)}
                      {row.specialtyId
                        ? ` · ${nameOf(reference.data?.specialties, row.specialtyId)}`
                        : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatWhen(row.startsAt)} — {hours} hours
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {row.urgency !== 'ROUTINE' ? (
                      <Badge variant={row.urgency === 'EMERGENCY' ? 'destructive' : 'warning'}>
                        {humanise(row.urgency)}
                      </Badge>
                    ) : null}
                    <Badge variant="secondary">{humanise(row.shiftType)}</Badge>
                    <StatusBadge status={row.status} />
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <DetailGrid>
                    <Detail label="Ends">{formatWhen(row.endsAt)}</Detail>
                    <Detail label="Hourly rate">{formatNaira(row.hourlyRateKobo)}</Detail>
                    <Detail label="Estimated cost">
                      {formatNaira(row.hourlyRateKobo * hours * row.headcount)}
                    </Detail>
                    <Detail label="Filled">
                      <span className="tabular">
                        {filled} of {row.headcount}
                      </span>
                    </Detail>
                  </DetailGrid>

                  {row.notes ? (
                    <p className="rounded-md bg-muted px-3 py-2 text-sm">{row.notes}</p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {row.status === 'PUBLISHED' || row.status === 'FILLED' ? (
                      <Link
                        href={`/facility/shifts/${row.id}`}
                        className={buttonVariants({ variant: 'outline' })}
                      >
                        <Users />
                        Find and confirm staff
                      </Link>
                    ) : null}
                    {row.status === 'PUBLISHED' || row.status === 'DRAFT' ? (
                      <Button
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => {
                          setCancelling(row);
                          setReason('');
                        }}
                      >
                        Cancel this shift
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={cancelling !== null} onOpenChange={(next: boolean) => !next && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this shift</DialogTitle>
            <DialogDescription>
              Any invitation still waiting for an answer is withdrawn. Anybody already confirmed
              keeps their assignment — cancel that separately, so nobody loses a shift without
              being told.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              rows={2}
              placeholder="Why the shift is no longer needed."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3}
              loading={cancel.isPending}
              onClick={() =>
                cancelling &&
                cancel.mutate({ id: cancelling.id }, { onSuccess: () => setCancelling(null) })
              }
            >
              Cancel the shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
