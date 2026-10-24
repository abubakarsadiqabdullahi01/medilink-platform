'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gavel } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { EmptyState, PageHeader, QueueSkeleton, ErrorState } from '@/components/app/page-shell';
import { PartyCaseDialog, type PartyCase } from '@/components/app/dispute-case';
import { formatAgo, formatWhen } from '@/components/app/format';

interface Case extends PartyCase {
  facilityName: string;
  shiftStartsAt: string;
  raisedByYou: boolean;
  /** The facility raised it, you have not replied, and it is still live. */
  youMustReply: boolean;
}

const LIVE = ['OPEN', 'UNDER_REVIEW'];

/**
 * The practitioner's own disputes.
 *
 * Every text about a case ends "open Medilink to read it", and until this screen there was no
 * place on this side to open: a practitioner could raise a case from a timesheet and never see
 * it again, and one a facility raised over their shift could be read nowhere. Here they read it,
 * write the one reply they are asked for, add what they have, and take back one they raised.
 * What they cannot do is edit or remove evidence, or decide anything.
 *
 * The reply-by date is a marker, not a lock: a reply can still be written after it, and the
 * officer can decide without one.
 */
export default function PractitionerDisputesPage() {
  const [open, setOpen] = useState<Case | null>(null);

  const cases = useQuery({
    queryKey: ['practitioner-disputes'],
    queryFn: () => api.get<{ disputes: Case[] }>('/api/v1/disputes/mine'),
  });
  const rows = cases.data?.disputes ?? [];
  const live = rows.filter((row) => LIVE.includes(row.status));
  const awaiting = rows.filter((row) => row.youMustReply);

  return (
    <>
      <PageHeader
        title="Disputes"
        description="Cases over your shifts, from either side. A person at Medilink decides each one; until then you can read it, reply to one a facility raised, add what you have, and take back one you raised."
      />

      {cases.isPending ? (
        <QueueSkeleton rows={2} />
      ) : cases.isError ? (
        <ErrorState message="Your disputes could not be loaded." onRetry={() => void cases.refetch()} retrying={cases.isFetching} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Gavel />}
          title="No disputes"
          description="A case appears here when you or a facility raise one over a shift. You can raise one from Timesheets."
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
                for a shift in dispute is held back until it is decided.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-3">
            {rows.map((row) => (
              <Card key={row.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {humanise(row.category)} · {row.facilityName}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Shift {formatWhen(row.shiftStartsAt)} · raised {formatAgo(row.createdAt)} by{' '}
                      {row.raisedByYou ? 'you' : 'the facility'}
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

      {open ? (
        <PartyCaseDialog
          viewer={{ side: 'PRACTITIONER' }}
          row={open}
          title={`${humanise(open.category)} · ${open.facilityName}`}
          description={`Shift ${formatWhen(open.shiftStartsAt)} · raised by ${open.raisedByYou ? 'you' : 'the facility'}`}
          listKey={['practitioner-disputes']}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}
