'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Clock, Inbox, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useNow } from '@/lib/ui/now';
import { useQueue, useQueueAction } from '@/lib/ui/queue';
import { nameOf, useReference } from '@/lib/ui/reference';
import { answerBy, closesIn, estimateKobo, shiftMinutes } from '@/lib/ui/shift-figures';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field } from '@/components/app/field';
import { Money } from '@/components/app/money';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { StaleNote } from '@/components/app/stale-note';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { formatMinutes, formatNaira, formatShiftWindow, formatWhen } from '@/components/app/format';

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
  /** What a dispute turns on: shown before the practitioner says yes, and kept when they do. */
  cancellationTerms: string;
  notes: string | null;
  addressLine: string;
  headcount: number;
  levelName: string | null;
  supervisionAvailable: boolean;
}

/** Answered offers shown before "show all". */
const RECENT_ANSWERED = 5;
/** What a decline needs written, so an empty or one-word reason does not reach the pilot's log. */
const MIN_DECLINE_REASON = 3;

/**
 * Offers, and answering them.
 *
 * **Accepting is not being confirmed**, and the card says so: the facility still has to confirm,
 * and a practitioner who thinks they have a shift when they do not is how a ward ends up short at
 * 6am.
 *
 * Each offer reads top to bottom in the order a person decides: who is asking, when and for how
 * long, what it pays, where it is and what happens if you cancel — then the two buttons. The
 * deadline is on it in words, with a mark, because a shift that lapses unanswered is gone.
 *
 * A decline needs a reason, and the reason is not a formality — declines feed the pilot's
 * suggestion log, without the practitioner's name attached, and are the main way anybody learns
 * the rate is too low or the notice too short. It is asked for in a dialog that says what
 * declining does, rather than in a text box open on every card.
 */
export default function OffersPage() {
  const reference = useReference();
  const now = useNow();
  const queueKey = ['invitations'];
  const queue = useQueue<Invitation>(
    queueKey,
    '/api/v1/invitations',
    (body) => (body as { invitations?: Invitation[] }).invitations ?? [],
  );

  // What has to be accepted before an offer can be: the server refuses an
  // acceptance without it, so say so up front rather than after the press.
  const agreements = useQuery({
    queryKey: ['agreements'],
    queryFn: () =>
      api.get<{ agreements: { id: string; title: string; acceptedAt: string | null }[] }>(
        '/api/v1/agreements',
      ),
  });
  const outstanding = (agreements.data?.agreements ?? []).filter((row) => !row.acceptedAt);

  const [declining, setDeclining] = useState<Invitation | null>(null);
  const [reason, setReason] = useState('');
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const [showAllAnswered, setShowAllAnswered] = useState(false);

  const respond = useQueueAction<{ id: string; decision: 'accept' | 'decline'; reason?: string }>({
    queueKey,
    run: ({ id, decision, reason: why }) =>
      api.post(`/api/v1/invitations/${id}/respond`, {
        decision,
        reason: why?.trim() || undefined,
      }),
    success: ({ decision }) =>
      decision === 'accept'
        ? 'Accepted — the facility still has to confirm you'
        : 'Declined, and your reason goes to the platform without your name',
    onDone: ({ id, decision }) => {
      if (decision === 'accept') setAcceptedId(id);
    },
  });

  const open = (queue.data ?? []).filter((row) => row.status === 'INVITED');
  const answered = (queue.data ?? []).filter((row) => row.status !== 'INVITED');
  // Months of history buried the one or two offers waiting on an answer; the
  // rest are a click away.
  const visibleAnswered = showAllAnswered ? answered : answered.slice(0, RECENT_ANSWERED);
  const accepted = acceptedId ? answered.find((row) => row.id === acceptedId) : undefined;

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

      {outstanding.length > 0 ? (
        <Alert variant="warning" className="mb-6">
          <TriangleAlert />
          <AlertDescription>
            <strong>You need to accept {outstanding.map((row) => row.title).join(' and ')}</strong>{' '}
            before you can accept an offer. You can still decline.{' '}
            <Link href="/practitioner/profile?tab=privacy" className="font-medium underline">
              Read and accept
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      {accepted ? (
        <Alert variant="info" className="mb-6">
          <Clock />
          <AlertDescription>
            <strong>
              You accepted {accepted.facilityName},{' '}
              {formatShiftWindow(accepted.startsAt, accepted.endsAt)}.
            </strong>{' '}
            The facility decides next. The shift is not yours until they confirm you, and it appears
            in{' '}
            <Link href="/practitioner/shifts" className="font-medium underline">
              My shifts
            </Link>{' '}
            when they do.
          </AlertDescription>
        </Alert>
      ) : null}

      <StaleNote
        show={queue.isError && Boolean(queue.data)}
        onRetry={() => void queue.refetch()}
        retrying={queue.isFetching}
        what="your offers"
      />

      {queue.isPending ? (
        <ListSkeleton rows={2} label="Loading your offers" />
      ) : queue.isError && !queue.data ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : open.length === 0 && answered.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="No offers yet"
          description="A facility offers you a shift and it appears here, with a deadline to answer by."
        />
      ) : (
        <div className="space-y-6">
          {open.length === 0 ? (
            <EmptyState
              compact
              icon={<Inbox />}
              title="Nothing waiting for an answer"
              description="A new offer appears here with a deadline to answer by."
            />
          ) : (
            <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {open.map((row) => {
                const lapsed = new Date(row.expiresAt) <= now;
                const minutes = shiftMinutes(row.startsAt, row.endsAt);
                const left = closesIn(row.expiresAt, now);
                const accepting =
                  respond.isPending &&
                  respond.variables?.id === row.id &&
                  respond.variables.decision === 'accept';

                return (
                  <Card key={row.id}>
                    <CardContent className="space-y-4 p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="font-semibold leading-snug [overflow-wrap:anywhere]">
                            {row.facilityName}
                          </h2>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {professionOf(row)}
                            {row.levelName ? ` · ${row.levelName}` : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                          {row.urgency !== 'ROUTINE' ? (
                            <Badge
                              variant={row.urgency === 'EMERGENCY' ? 'destructive' : 'warning'}
                            >
                              {humanise(row.urgency)}
                            </Badge>
                          ) : null}
                          <Badge variant="secondary">{humanise(row.shiftType)}</Badge>
                        </div>
                      </div>

                      {/* The deadline, with a mark and the words, so it survives a greyscale
                          screen and is never only a colour. */}
                      <p
                        className={`flex items-start gap-2 text-sm ${
                          lapsed || left?.soon ? 'font-medium text-destructive-text' : ''
                        }`}
                      >
                        {lapsed || left?.soon ? (
                          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        ) : (
                          <Clock
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                        <span>
                          {lapsed ? 'This offer has lapsed.' : answerBy(row.expiresAt, now)}
                          {left && !lapsed ? ` · ${left.text}` : ''}
                        </span>
                      </p>

                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                        <div className="col-span-2 min-w-0">
                          <dt className="text-sm text-muted-foreground">When</dt>
                          <dd className="[overflow-wrap:anywhere]">
                            {formatShiftWindow(row.startsAt, row.endsAt)}
                            <span className="text-muted-foreground">
                              {' '}
                              · {formatMinutes(minutes)}
                            </span>
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-sm text-muted-foreground">Rate</dt>
                          <dd className="tabular">{formatNaira(row.hourlyRateKobo)}/hour</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-sm text-muted-foreground">At that rate</dt>
                          <dd>
                            <Money kobo={estimateKobo(row.hourlyRateKobo, minutes)} strong />
                          </dd>
                        </div>
                        {row.headcount > 1 ? (
                          <div className="col-span-2 min-w-0 text-sm text-muted-foreground">
                            The facility needs {row.headcount} practitioners for this shift.
                          </div>
                        ) : null}
                        {row.supervisionAvailable ? (
                          <div className="col-span-2 min-w-0 text-sm text-muted-foreground">
                            Someone will supervise.
                          </div>
                        ) : null}
                      </dl>
                      <p className="-mt-2 text-sm text-muted-foreground">
                        Night and holiday hours are priced against the facility&rsquo;s rate card
                        when the shift is invoiced.
                      </p>

                      {/* The things an agreement turns on, read before the button rather than
                          found afterwards. Accepting keeps a copy of exactly what is on this card. */}
                      <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                        <div>
                          <p className="text-sm font-medium">Where</p>
                          <p className="text-sm [overflow-wrap:anywhere]">
                            {row.facilityName}, {row.addressLine}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-medium">If you cancel</p>
                          <p className="text-sm [overflow-wrap:anywhere]">
                            {row.cancellationTerms}
                          </p>
                        </div>
                        {row.notes ? (
                          <div>
                            <p className="text-sm font-medium">
                              From the facility — ward, who to report to, what to bring
                            </p>
                            <p className="whitespace-pre-line text-sm [overflow-wrap:anywhere]">
                              {row.notes}
                            </p>
                          </div>
                        ) : null}
                      </div>

                      {lapsed ? (
                        <p className="text-sm text-muted-foreground">
                          It will be withdrawn shortly, and cannot be accepted now.
                        </p>
                      ) : (
                        <>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              className="sm:flex-1"
                              loading={accepting}
                              disabled={respond.isPending && !accepting}
                              onClick={() => respond.mutate({ id: row.id, decision: 'accept' })}
                            >
                              Accept
                            </Button>
                            <Button
                              variant="outline"
                              className="sm:flex-1"
                              aria-label={`Decline the offer from ${row.facilityName}`}
                              disabled={respond.isPending}
                              onClick={() => {
                                setDeclining(row);
                                setReason('');
                              }}
                            >
                              Decline
                            </Button>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            By accepting you agree to the cancellation terms above, and a record is
                            kept of what you were shown.
                          </p>
                        </>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {answered.length > 0 ? (
            <section aria-labelledby="answered-heading">
              <h2 id="answered-heading" className="mb-2 text-sm font-medium text-muted-foreground">
                Already answered
              </h2>
              <ul className="divide-y rounded-lg border bg-card">
                {visibleAnswered.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="[overflow-wrap:anywhere]">
                        {professionOf(row)} · {row.facilityName}
                      </p>
                      <p className="text-sm text-muted-foreground">{formatWhen(row.startsAt)}</p>
                      {row.status === 'ACCEPTED' ? (
                        <p className="text-sm text-muted-foreground">
                          Waiting for the facility to confirm you.
                        </p>
                      ) : null}
                      {row.declineReason ? (
                        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                          &ldquo;{row.declineReason}&rdquo;
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge status={row.status} />
                  </li>
                ))}
              </ul>
              {answered.length > RECENT_ANSWERED ? (
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => setShowAllAnswered((value) => !value)}
                >
                  {showAllAnswered
                    ? 'Show only the most recent'
                    : `Show all ${answered.length} answered offers`}
                </Button>
              ) : null}
            </section>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={declining !== null}
        onOpenChange={(next) => !next && setDeclining(null)}
        title="Decline this offer"
        object={
          declining
            ? `${declining.facilityName} · ${professionOf(declining)} · ${formatShiftWindow(declining.startsAt, declining.endsAt)}`
            : ''
        }
        consequence="The offer closes and you cannot accept it afterwards. Your reason goes to the platform without your name; it is how the pilot learns when a rate is too low or notice too short."
        reversible={false}
        destructive
        confirmLabel="Decline the offer"
        cancelLabel="Keep the offer"
        loading={respond.isPending}
        confirmDisabled={reason.trim().length < MIN_DECLINE_REASON}
        onConfirm={() =>
          declining &&
          respond.mutate(
            { id: declining.id, decision: 'decline', reason },
            { onSuccess: () => setDeclining(null) },
          )
        }
      >
        <Field
          label="Why are you declining?"
          hint="Required. For example: rate too low, notice too short, too far to travel."
          required
        >
          <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}
