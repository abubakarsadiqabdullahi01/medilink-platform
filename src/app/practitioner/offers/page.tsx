'use client';

import { useState } from 'react';
import { Inbox, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useQueue, useQueueAction } from '@/lib/ui/queue';
import { nameOf, useReference } from '@/lib/ui/reference';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import {
  Detail,
  DetailGrid,
  EmptyState,
  PageHeader,
  QueueSkeleton,
} from '@/components/app/page-shell';
import { formatAgo, formatNaira, formatWhen } from '@/components/app/format';

interface Invitation {
  id: string;
  serviceRequestId: string;
  userId: string;
  status: string;
  expiresAt: string;
  declineReason: string | null;
  createdAt: string;
  facilityName: string;
  professionalCategoryId: string;
  specialtyId: string | null;
  shiftType: string;
  hourlyRateKobo: number;
  urgency: string;
  startsAt: string;
  endsAt: string;
}

/** Answered offers shown before "show all". */
const RECENT_ANSWERED = 10;
/**
 * Offers, and answering them.
 *
 * **Accepting is not being confirmed**, and the card says so: the facility
 * still has to confirm, and a practitioner who thinks they have a shift when
 * they do not is how a ward ends up short at 6am.
 *
 * A decline needs a reason, and the reason is not a formality — declines feed
 * the pilot's suggestion log, without the practitioner's name attached, and
 * are the main way anybody learns the rate is too low or the notice too
 * short.
 *
 * Every card used to say only "Shift a3f92e1c" — a decision that commits
 * somebody's time, made with no facility, no rate and no times to decide it
 * against. That was the offer itself withholding the answer to the only
 * question that matters here.
 */
export default function OffersPage() {
  const reference = useReference();
  const queueKey = ['invitations'];
  const queue = useQueue<Invitation>(
    queueKey,
    '/api/v1/invitations',
    (body) => (body as { invitations?: Invitation[] }).invitations ?? [],
  );

  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [showAllAnswered, setShowAllAnswered] = useState(false);

  const respond = useQueueAction<{ id: string; decision: 'accept' | 'decline' }>({
    queueKey,
    run: ({ id, decision }) =>
      api.post(`/api/v1/invitations/${id}/respond`, {
        decision,
        reason: reasons[id]?.trim() || undefined,
      }),
    success: ({ decision }) =>
      decision === 'accept'
        ? 'Accepted — the facility still has to confirm you'
        : 'Declined, and your reason goes to the platform without your name',
  });

  const open = (queue.data ?? []).filter((row) => row.status === 'INVITED');
  const answered = (queue.data ?? []).filter((row) => row.status !== 'INVITED');
  // Months of history buried the one or two offers waiting on an answer; the
  // rest are a click away.
  const visibleAnswered = showAllAnswered ? answered : answered.slice(0, RECENT_ANSWERED);

  const professionOf = (row: Invitation) => {
    const category = nameOf(reference.data?.professionalCategories, row.professionalCategoryId);
    return row.specialtyId
      ? `${category} · ${nameOf(reference.data?.specialties, row.specialtyId)}`
      : category;
  };

  return (
    <>
      <PageHeader
        title="Offers"
        description="Accepting is not the same as being confirmed — the facility confirms, and only then is the shift yours. Nothing is committed until they do."
      />

      {queue.isPending ? (
        <QueueSkeleton />
      ) : queue.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>Your offers could not be loaded.</AlertDescription>
        </Alert>
      ) : open.length === 0 && answered.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="No offers yet"
          description="A facility offers you a shift and it appears here, with a deadline to answer by."
        />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {open.map((row) => {
            const lapsed = new Date(row.expiresAt) < new Date();
            const reason = reasons[row.id]?.trim() ?? '';

            return (
              <Card key={row.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                  <div className="min-w-0">
                    <p className="font-medium">{professionOf(row)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{row.facilityName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      offered {formatAgo(row.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
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
                    <Detail label="Starts">{formatWhen(row.startsAt)}</Detail>
                    <Detail label="Ends">{formatWhen(row.endsAt)}</Detail>
                    <Detail label="Rate">{formatNaira(row.hourlyRateKobo)}/hour</Detail>
                    <Detail label="Answer by">{formatWhen(row.expiresAt)}</Detail>
                  </DetailGrid>

                  {lapsed ? (
                    <Alert variant="warning">
                      <TriangleAlert />
                      <AlertDescription>
                        This offer has lapsed. The sweep will withdraw it shortly.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Label htmlFor={`reason-${row.id}`}>
                          If you are declining, why?{' '}
                          <span className="font-normal text-muted-foreground">
                            — required, and it reaches the platform without your name
                          </span>
                        </Label>
                        <Textarea
                          id={`reason-${row.id}`}
                          rows={2}
                          placeholder="Rate too low, notice too short, too far to travel…"
                          value={reasons[row.id] ?? ''}
                          onChange={(event) =>
                            setReasons((current) => ({ ...current, [row.id]: event.target.value }))
                          }
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          loading={
                            respond.isPending &&
                            respond.variables?.id === row.id &&
                            respond.variables.decision === 'accept'
                          }
                          onClick={() => respond.mutate({ id: row.id, decision: 'accept' })}
                        >
                          Accept
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!reason || respond.isPending}
                          onClick={() => respond.mutate({ id: row.id, decision: 'decline' })}
                        >
                          Decline
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {answered.length > 0 ? (
            <>
              <h2 className="col-span-full pt-2 text-sm font-medium text-muted-foreground">
                Already answered
              </h2>
              {visibleAnswered.map((row) => (
                <Card key={row.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
                    <div className="min-w-0">
                      <p className="text-sm">
                        {professionOf(row)} · {row.facilityName}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatWhen(row.startsAt)}
                      </p>
                      {row.declineReason ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          &ldquo;{row.declineReason}&rdquo;
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge status={row.status} />
                  </CardContent>
                </Card>
              ))}
              {answered.length > RECENT_ANSWERED ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAllAnswered((value) => !value)}
                >
                  {showAllAnswered
                    ? 'Show only the most recent'
                    : `Show all ${answered.length} answered offers`}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
