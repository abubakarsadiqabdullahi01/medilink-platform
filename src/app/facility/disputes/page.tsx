'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gavel } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { EmptyState, PageHeader, QueueSkeleton, ErrorState } from '@/components/app/page-shell';
import { PartyCaseDialog, type PartyCase } from '@/components/app/dispute-case';
import { formatAgo, formatWhen } from '@/components/app/format';

interface Case extends PartyCase {
  practitionerName: string;
  shiftStartsAt: string;
  raisedByFacility: boolean;
  /** The practitioner raised it, nobody here has replied, and it is still live. */
  youMustReply: boolean;
}

const LIVE = ['OPEN', 'UNDER_REVIEW'];

/**
 * Disputes over this facility's shifts.
 *
 * A case is an argument between the facility and a practitioner about a shift,
 * decided by somebody at Medilink. The facility was one of its two sides in the
 * rules and in nothing else: no screen, and every route a party needs asked for
 * the practitioner's own standing. Here the facility reads the case, sees what the
 * practitioner attached, adds its own and, if it raised the case, takes it back.
 * What it cannot do is edit or remove evidence, or decide anything.
 *
 * When the practitioner raised the case the facility is the side asked to reply, by a date the
 * case carries. The date is a marker, not a lock: a reply can still be written after it.
 */
export default function FacilityDisputesPage() {
  const facilityId = useFacilityId();
  const [open, setOpen] = useState<Case | null>(null);

  const cases = useQuery({
    queryKey: ['facility-disputes', facilityId],
    queryFn: () => api.get<{ disputes: Case[] }>(`/api/v1/disputes?facilityId=${facilityId}`),
    enabled: Boolean(facilityId),
  });
  const rows = cases.data?.disputes ?? [];
  const live = rows.filter((row) => LIVE.includes(row.status));
  const awaiting = rows.filter((row) => row.youMustReply);

  return (
    <>
      <PageHeader
        title="Disputes"
        description="Cases over your shifts, from either side. A person at Medilink decides each one; until then you can read it, reply to one a practitioner raised, add what you have, and take back one you raised."
      />

      {!facilityId || cases.isPending ? (
        <QueueSkeleton rows={2} />
      ) : cases.isError ? (
        <ErrorState message="The disputes could not be loaded." onRetry={() => void cases.refetch()} retrying={cases.isFetching} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Gavel />}
          title="No disputes"
          description="A case appears here when you or a practitioner raise one over a shift."
        />
      ) : (
        <>
          {awaiting.length > 0 ? (
            <Alert variant="warning" className="mb-4">
              <AlertDescription>
                {awaiting.length} {awaiting.length === 1 ? 'case is' : 'cases are'} waiting for your
                reply. Open {awaiting.length === 1 ? 'it' : 'each'} and say what happened from your
                side; the officer reads it before deciding.
              </AlertDescription>
            </Alert>
          ) : null}
          {live.length > 0 ? (
            <Alert variant="info" className="mb-4">
              <AlertDescription>
                {live.length} {live.length === 1 ? 'case is' : 'cases are'} still open. The money
                for a shift in dispute is held back from the practitioner until it is decided.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-3">
            {rows.map((row) => (
              <Card key={row.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {humanise(row.category)} · {row.practitionerName}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Shift {formatWhen(row.shiftStartsAt)} · raised {formatAgo(row.createdAt)} by{' '}
                      {row.raisedByFacility ? 'you' : 'the practitioner'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {row.youMustReply ? (
                      <Badge variant={row.responseOverdue ? 'destructive' : 'warning'}>
                        {row.responseOverdue ? 'Reply overdue' : `Reply by ${formatWhen(row.respondBy)}`}
                      </Badge>
                    ) : null}
                    <StatusBadge status={row.status} />
                    <Button variant="outline" size="sm" onClick={() => setOpen(row)}>
                      Open
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {open && facilityId ? (
        <PartyCaseDialog
          viewer={{ side: 'FACILITY', facilityId }}
          row={open}
          title={`${humanise(open.category)} · ${open.practitionerName}`}
          description={`Shift ${formatWhen(open.shiftStartsAt)} · raised by ${open.raisedByFacility ? 'you' : 'the practitioner'}`}
          listKey={['facility-disputes']}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

