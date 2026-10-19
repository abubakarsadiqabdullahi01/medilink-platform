'use client';

import { useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CircleCheck,
  Circle,
  Clock,
  Info,
  Sparkles,
  TriangleAlert,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { useNow } from '@/lib/ui/now';
import { useSession } from '@/lib/ui/session';
import { nameOf, useReference } from '@/lib/ui/reference';
import { readyToConfirm, shiftNextStep, shiftProgress } from '@/lib/ui/shift-progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Money } from '@/components/app/money';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Timeline } from '@/components/app/timeline';
import { formatMinutes, formatShiftWindow, formatWhen } from '@/components/app/format';
import { EXCLUSION_WORDS } from '@/modules/matching/domain/matching-rules';
import type { ExclusionReason } from '@/modules/matching/domain/engine';
import { OfferReviewDialog } from './offer-review-dialog';

interface ServiceRequest {
  id: string;
  professionalCategoryId: string;
  specialtyId: string | null;
  cadreLevelId: string | null;
  supervisionAvailable: boolean;
  shiftType: string;
  startsAt: string;
  endsAt: string;
  headcount: number;
  hourlyRateKobo: number;
  urgency: string;
  status: string;
  notes: string | null;
  cancellationTerms?: string | null;
}

interface Factor {
  factor: string;
  weight: number;
  raw: number;
  points: number;
  detail: string;
}

interface Ranked {
  userId: string;
  rank: number;
  score: number;
  factors: Factor[];
  /** Initials only. A match result is not a directory; a booking releases the name. */
  practitionerName: string;
}

/** Anonymous by design: why somebody was left out, never who. */
interface Excluded {
  reasons: string[];
}

interface MatchRun {
  id: string;
  consideredCount: number;
  rankedCount: number;
  ranked: Ranked[];
  excluded: Excluded[];
  createdAt: string;
}

interface Invitation {
  id: string;
  userId: string;
  practitionerName: string;
  status: string;
  expiresAt: string;
  declineReason: string | null;
}

interface Assignment {
  id: string;
  userId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  practitionerName: string;
  practitionerPhone: string;
}

/** How many candidates each reason accounts for. One person can have several. */
function countReasons(rows: Excluded[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const reason of row.reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

/** Declined offers are the practitioner's answer, so asking them again is not offered. */
const OFFER_ORDER: Record<string, number> = {
  INVITED: 0,
  ACCEPTED: 1,
  DECLINED: 2,
  EXPIRED: 3,
  WITHDRAWN: 4,
};

/**
 * One shift: rank, offer, confirm.
 *
 * **The page says what to do next.** A shift is always in one of a handful of states — nobody
 * asked yet, waiting for answers, somebody said yes and wants confirming, full — and the first
 * thing on the page is the sentence for the one it is in. What needs the scheduler's decision
 * (an acceptance to confirm) comes before what is only a record (offers sent, who is booked).
 *
 * **The ranking explains itself.** Every candidate carries the factors that produced their
 * score, and they are shown rather than hidden behind a number — step 9.4 requires every match
 * to be reviewed by hand for the first fifty engagements, and a reviewer given only "82" has
 * nothing to review.
 *
 * **Nothing invites automatically.** The engine ranks; a person chooses, then reads the offer
 * back before it goes. Nothing is booked until the practitioner accepts and a person confirms.
 */
export default function ShiftDetailPage() {
  const params = useParams<{ id: string }>();
  const requestId = params.id;
  const facilityId = useFacilityId();
  const reference = useReference();
  const queryClient = useQueryClient();
  const now = useNow();

  // Matching, offering and confirming are all guarded on assignment.confirm.
  // This page is reached on service_request.read, which an administrator and
  // an accounts officer hold without it, so the controls are hidden rather
  // than left to answer 403 — the same rule the dashboard already follows.
  const canStaff = useSession().permissions.includes('assignment.confirm');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [offering, setOffering] = useState(false);
  const [confirming, setConfirming] = useState<Invitation | null>(null);

  const shift = useQuery({
    queryKey: ['shift', requestId],
    queryFn: () =>
      api.get<ServiceRequest>(`/api/v1/service-requests/${requestId}?facilityId=${facilityId}`),
    enabled: Boolean(facilityId),
  });

  const assignments = useQuery({
    queryKey: ['shift-assignments', facilityId, requestId],
    queryFn: () =>
      api.get<{ assignments: Assignment[] }>(
        `/api/v1/assignments?scopeType=FACILITY&scopeId=${facilityId}&serviceRequestId=${requestId}&include=contact`,
      ),
    enabled: Boolean(facilityId),
  });

  const [matchRun, setMatchRun] = useState<MatchRun | null>(null);

  /**
   * The offers, read from the server rather than remembered by the page.
   *
   * They used to live in component state, filled by the invite response —
   * so the advice below to "refresh after they answer" emptied the very list
   * the confirmation is made from, and an accepted offer could only be
   * confirmed by somebody who had never navigated away.
   */
  const offers = useQuery({
    queryKey: ['shift-invitations', facilityId, requestId],
    queryFn: () =>
      api.get<{ invitations: Invitation[] }>(
        `/api/v1/service-requests/${requestId}/invitations?facilityId=${facilityId}`,
      ),
    enabled: Boolean(facilityId),
    // While anybody has yet to answer, look again now and then, so an
    // acceptance turns up without the scheduler having to think of reloading.
    refetchInterval: (query) =>
      query.state.data?.invitations.some((row) => row.status === 'INVITED') ? 15_000 : false,
  });
  const invitations = offers.data?.invitations ?? [];

  const runMatch = useMutation({
    mutationFn: () =>
      api.post<MatchRun>(`/api/v1/service-requests/${requestId}/match`, { facilityId }),
    onSuccess: (data) => {
      setMatchRun(data);
      toast.success(`${data.rankedCount} of ${data.consideredCount} practitioners are eligible`);
    },
    onError: (error) =>
      toast.error('Could not run the match', { description: errorMessage(error) }),
  });

  const invite = useMutation({
    mutationFn: () =>
      api.post<Invitation[]>(`/api/v1/service-requests/${requestId}/invite`, {
        facilityId,
        userIds: [...selected],
        matchRunId: matchRun?.id,
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['shift-invitations'] });
      setSelected(new Set());
      setOffering(false);
      toast.success(`Offered to ${data.length} practitioner${data.length === 1 ? '' : 's'}`);
    },
    onError: (error) =>
      toast.error('Could not send the offer', { description: errorMessage(error) }),
  });

  const confirm = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/api/v1/service-requests/${requestId}/confirm`, { facilityId, userId }),
    onSuccess: () => {
      toast.success('Practitioner confirmed onto the shift');
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: ['shift-assignments'] });
      // Filling the last place withdraws everybody else's offer.
      void queryClient.invalidateQueries({ queryKey: ['shift-invitations'] });
      void queryClient.invalidateQueries({ queryKey: ['shift', requestId] });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
    },
    onError: (error) => toast.error('Could not confirm', { description: errorMessage(error) }),
  });

  const confirmed = (assignments.data?.assignments ?? []).filter(
    (row) => row.status === 'CONFIRMED' || row.status === 'COMPLETED',
  );
  const confirmedIds = new Set(confirmed.map((row) => row.userId));
  const offerByUser = new Map(invitations.map((row) => [row.userId, row]));

  function toggle(userId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  const request = shift.data;
  const minutes = request
    ? Math.round(
        (new Date(request.endsAt).getTime() - new Date(request.startsAt).getTime()) / 60_000,
      )
    : 0;
  const role = request
    ? nameOf(reference.data?.professionalCategories, request.professionalCategoryId)
    : '';
  const shiftLabel = request
    ? [
        role,
        request.specialtyId ? nameOf(reference.data?.specialties, request.specialtyId) : null,
        request.cadreLevelId ? nameOf(reference.data?.cadreLevels, request.cadreLevelId) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const windowLabel = request ? formatShiftWindow(request.startsAt, request.endsAt) : '';

  // Offering needs a published shift that has not started: the server refuses anything else.
  const openForOffers =
    request?.status === 'PUBLISHED' && new Date(request.startsAt).getTime() > now.getTime();
  const answersKnown = Boolean(offers.data && assignments.data);
  const facts = request
    ? {
        shift: request,
        confirmed: confirmed.length,
        offers: invitations,
        confirmedUserIds: confirmedIds,
      }
    : null;
  const next = facts && answersKnown ? shiftNextStep({ ...facts, now }) : null;
  const steps = facts && answersKnown ? shiftProgress(facts) : [];
  const ready = readyToConfirm(invitations, confirmedIds);
  const lastPlace = request ? confirmed.length + 1 >= request.headcount : false;

  const picked = (matchRun?.ranked ?? [])
    .filter((row) => selected.has(row.userId))
    .map((row) => ({ userId: row.userId, name: row.practitionerName }));

  return (
    <>
      <PageHeader
        title={request ? role : 'Shift'}
        description={
          request ? `${windowLabel} · ${formatMinutes(minutes)} · Lagos time` : undefined
        }
        breadcrumbs={[
          { label: 'Shifts', href: '/facility/shifts' },
          { label: request ? role : 'Shift' },
        ]}
        meta={request ? <StatusBadge status={request.status} /> : null}
      />

      {shift.isPending ? (
        <div aria-busy="true" className="space-y-4">
          <p role="status" className="sr-only">
            Loading the shift…
          </p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : shift.isError && !request ? (
        <ErrorState
          error={shift.error}
          onRetry={() => void shift.refetch()}
          retrying={shift.isFetching}
        />
      ) : request ? (
        <div className="space-y-6">
          {next ? (
            <NextStepNote kind={next.kind} text={next.text} />
          ) : offers.isError || assignments.isError ? (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertDescription>
                The offers or the roster for this shift could not be loaded, so what to do next
                cannot be worked out yet. Use Try again below.
              </AlertDescription>
            </Alert>
          ) : (
            <Skeleton className="h-14 w-full" />
          )}

          <Card>
            <CardContent className="pt-6">
              <dl className="grid gap-x-6 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(8rem,1fr))]">
                <Fact label="Shift type">{humanise(request.shiftType)}</Fact>
                {request.cadreLevelId ? (
                  <Fact label="Level">
                    {nameOf(reference.data?.cadreLevels, request.cadreLevelId)}
                    {request.supervisionAvailable ? ' · someone will supervise' : ''}
                  </Fact>
                ) : null}
                <Fact label="Urgency">{humanise(request.urgency)}</Fact>
                <Fact label="Rate per hour">
                  <Money kobo={request.hourlyRateKobo} />
                </Fact>
                <Fact label="Places filled">
                  <span className="tabular">
                    {assignments.data ? confirmed.length : '—'} of {request.headcount}
                  </span>
                </Fact>
              </dl>
              {request.cancellationTerms?.trim() ? (
                <div className="mt-4 space-y-1">
                  <p className="text-sm text-muted-foreground">If somebody cancels</p>
                  <p className="whitespace-pre-wrap">{request.cancellationTerms.trim()}</p>
                </div>
              ) : null}
              {request.notes ? (
                <div className="mt-4 space-y-1">
                  <p className="text-sm text-muted-foreground">Notes for the practitioner</p>
                  <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2">
                    {request.notes}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {ready.length > 0 ? (
            <Card className="border-warning/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserCheck className="size-5 text-warning" aria-hidden="true" />
                  Ready to confirm
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  They said yes. Nobody is booked until you confirm.
                </p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {ready.map((row) => {
                    const offer = invitations.find((item) => item.userId === row.userId)!;
                    return (
                      <li
                        key={offer.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                      >
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-medium">{offer.practitionerName}</span>
                          <StatusBadge status="ACCEPTED" />
                        </span>
                        {canStaff ? (
                          <Button
                            aria-label={`Confirm ${offer.practitionerName} onto this shift`}
                            onClick={() => {
                              confirm.reset();
                              setConfirming(offer);
                            }}
                          >
                            Confirm
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {canStaff && openForOffers ? (
            <Card>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">Who could work this</CardTitle>
                  {matchRun ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {matchRun.rankedCount} eligible of {matchRun.consideredCount} considered
                    </p>
                  ) : null}
                </div>
                <Button
                  variant={matchRun ? 'outline' : 'default'}
                  loading={runMatch.isPending}
                  onClick={() => runMatch.mutate()}
                >
                  <Sparkles />
                  {matchRun ? 'Run again' : 'Find candidates'}
                </Button>
              </CardHeader>

              <CardContent>
                {!matchRun ? (
                  <EmptyState
                    compact
                    icon={<UserPlus />}
                    title="No match run yet"
                    description="Ranking is a computation, not a decision — it changes nothing until you offer the shift to somebody."
                  />
                ) : matchRun.ranked.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<UserPlus />}
                    title="Nobody is eligible"
                    description="Every candidate was excluded. The reasons are listed below."
                  />
                ) : (
                  <>
                    <p id="candidate-help" className="mb-3 text-sm text-muted-foreground">
                      Choose who to offer it to. The engine ranks; a person chooses.
                    </p>
                    <ul aria-describedby="candidate-help" className="space-y-3">
                      {matchRun.ranked.map((candidate) => {
                        const isPicked = selected.has(candidate.userId);
                        const existing = offerByUser.get(candidate.userId);
                        // An offer that is open, answered or already a booking is not made again:
                        // the server treats that as a no-op, so ticking it would promise nothing.
                        const lapsed =
                          existing?.status === 'INVITED' &&
                          new Date(existing.expiresAt).getTime() <= now.getTime();
                        const offered =
                          confirmedIds.has(candidate.userId) ||
                          (existing !== undefined &&
                            !lapsed &&
                            existing.status !== 'WITHDRAWN' &&
                            existing.status !== 'EXPIRED');
                        return (
                          <li key={candidate.userId}>
                            <button
                              type="button"
                              data-testid={`candidate-${candidate.userId}`}
                              aria-pressed={isPicked}
                              disabled={offered}
                              onClick={() => toggle(candidate.userId)}
                              className={cn(
                                'min-h-11 w-full rounded-lg border p-4 text-left transition-colors',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                isPicked ? 'border-primary bg-accent' : 'hover:bg-muted/50',
                                offered && 'cursor-not-allowed opacity-70 hover:bg-transparent',
                              )}
                            >
                              <span className="flex items-start justify-between gap-3">
                                <span className="flex items-center gap-3">
                                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                                    <span className="sr-only">Rank </span>
                                    {candidate.rank}
                                  </span>
                                  <span>
                                    <span className="block font-medium">
                                      {candidate.practitionerName}
                                    </span>
                                    <span className="block text-sm text-muted-foreground">
                                      score <span className="tabular">{candidate.score}</span> of
                                      100
                                    </span>
                                  </span>
                                </span>
                                {offered ? (
                                  <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-muted-foreground">
                                    <Clock className="size-4" aria-hidden="true" />
                                    {confirmedIds.has(candidate.userId)
                                      ? 'Booked'
                                      : `Offer ${humanise(existing?.status ?? '').toLowerCase()}`}
                                  </span>
                                ) : isPicked ? (
                                  <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary">
                                    <CircleCheck className="size-5" aria-hidden="true" />
                                    Selected
                                  </span>
                                ) : (
                                  <Circle
                                    className="size-5 shrink-0 text-muted-foreground"
                                    aria-hidden="true"
                                  />
                                )}
                              </span>

                              {/* The factors, shown rather than summarised: a
                                  reviewer given only a number has nothing to
                                  review, and 9.4 requires review by hand. */}
                              <span className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                                {candidate.factors.map((factor) => (
                                  <span key={factor.factor} className="block text-sm">
                                    <span className="flex items-baseline justify-between gap-2">
                                      <span className="font-medium capitalize">
                                        {factor.factor}
                                      </span>
                                      <span className="text-right text-muted-foreground">
                                        {factor.detail}
                                      </span>
                                    </span>
                                    <span
                                      aria-hidden="true"
                                      className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"
                                    >
                                      <span
                                        className="block h-full rounded-full bg-primary/60"
                                        style={{ width: `${Math.round(factor.raw * 100)}%` }}
                                      />
                                    </span>
                                  </span>
                                ))}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>

                    <div className="sticky bottom-0 -mx-6 -mb-6 mt-4 flex flex-wrap items-center gap-3 border-t bg-card px-6 py-4">
                      <Button
                        disabled={selected.size === 0}
                        onClick={() => {
                          invite.reset();
                          setOffering(true);
                        }}
                      >
                        <UserCheck />
                        Offer to {selected.size || 'the'} selected
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        {selected.size === 0
                          ? 'Choose at least one person. You will read the offer back before it goes.'
                          : 'You will read the offer back before it goes.'}
                      </p>
                    </div>
                  </>
                )}

                {matchRun && matchRun.excluded.length > 0 ? (
                  <details className="mt-6">
                    <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted-foreground">
                      {matchRun.excluded.length} left out, and why
                    </summary>
                    {/* The reason counted, and what it means in a ward manager's words. For somebody
                        who offered part of the shift, that is the one thing here worth acting on. */}
                    <ul className="mt-3 space-y-2">
                      {Object.entries(countReasons(matchRun.excluded)).map(([reason, count]) => {
                        const words = EXCLUSION_WORDS[reason as ExclusionReason];
                        return (
                          <li
                            key={reason}
                            className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
                          >
                            <Badge variant="secondary">
                              {words?.label ?? humanise(reason)} · {count}
                            </Badge>
                            {words ? (
                              <span className="text-sm text-muted-foreground">{words.says}</span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-2 text-sm text-muted-foreground">
                      People are not named here: this list explains why the pool is the size it is,
                      not who is busy or unverified.
                    </p>
                  </details>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <section aria-labelledby="offers-heading">
            <h2 id="offers-heading" className="mb-3 text-lg font-semibold">
              Offers sent
            </h2>
            {offers.isPending ? (
              <ListSkeleton rows={1} label="Loading offers" />
            ) : offers.isError && !offers.data ? (
              <ErrorState
                error={offers.error}
                onRetry={() => void offers.refetch()}
                retrying={offers.isFetching}
                compact
              />
            ) : invitations.length === 0 ? (
              <EmptyState
                compact
                icon={<Info />}
                title="No offers yet"
                description="Offers you send appear here with the answer to each."
              />
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <ul className="space-y-2">
                    {[...invitations]
                      .sort((a, b) => (OFFER_ORDER[a.status] ?? 9) - (OFFER_ORDER[b.status] ?? 9))
                      .map((row) => {
                        const lapsed =
                          row.status === 'INVITED' &&
                          new Date(row.expiresAt).getTime() <= now.getTime();
                        return (
                          <li
                            key={row.id}
                            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border px-3 py-2"
                          >
                            <span className="font-medium">{row.practitionerName}</span>
                            <span className="flex flex-wrap items-center gap-2">
                              {row.status === 'INVITED' ? (
                                <span className="text-sm text-muted-foreground">
                                  {lapsed ? 'lapsed' : 'answer by'} {formatWhen(row.expiresAt)}
                                </span>
                              ) : null}
                              <StatusBadge status={lapsed ? 'EXPIRED' : row.status} />
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                  <p className="pt-3 text-sm text-muted-foreground">
                    Accepting is not being confirmed — you still decide. Answers appear here as they
                    come in.
                  </p>
                </CardContent>
              </Card>
            )}
          </section>

          <section aria-labelledby="confirmed-heading">
            <h2 id="confirmed-heading" className="mb-3 text-lg font-semibold">
              Confirmed
            </h2>
            {assignments.isPending ? (
              <ListSkeleton rows={1} label="Loading the roster" />
            ) : assignments.isError && !assignments.data ? (
              <ErrorState
                error={assignments.error}
                onRetry={() => void assignments.refetch()}
                retrying={assignments.isFetching}
                compact
              />
            ) : confirmed.length === 0 ? (
              <EmptyState
                compact
                icon={<Info />}
                title="Nobody is confirmed yet"
                description={`This shift needs ${request.headcount}.`}
              />
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <ul className="space-y-2">
                    {confirmed.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="font-medium [overflow-wrap:anywhere]">
                            {row.practitionerName}
                          </p>
                          {row.practitionerPhone ? (
                            <p className="tabular text-sm text-muted-foreground">
                              {row.practitionerPhone}
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Phone shown from 2 days before the shift
                            </p>
                          )}
                        </div>
                        <StatusBadge status={row.status} />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </section>

          {steps.length > 0 ? (
            <section aria-labelledby="progress-heading">
              <h2 id="progress-heading" className="mb-3 text-lg font-semibold">
                How this shift is progressing
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <Timeline label="Progress of this shift" steps={steps} />
                </CardContent>
              </Card>
            </section>
          ) : null}
        </div>
      ) : null}

      {request ? (
        <>
          <OfferReviewDialog
            open={offering}
            onOpenChange={setOffering}
            shiftLabel={shiftLabel}
            windowLabel={windowLabel}
            minutes={minutes}
            hourlyRateKobo={request.hourlyRateKobo}
            terms={request.cancellationTerms}
            people={picked}
            sending={invite.isPending}
            error={invite.isError ? invite.error : null}
            onSend={() => invite.mutate()}
          />

          <ConfirmDialog
            open={confirming !== null}
            onOpenChange={(open) => !open && setConfirming(null)}
            title="Confirm onto this shift"
            object={
              confirming ? `${confirming.practitionerName} · ${shiftLabel} · ${windowLabel}` : ''
            }
            consequence={
              confirming ? (
                <>
                  {confirming.practitionerName} is booked onto this shift and sent a message saying
                  so.
                  {lastPlace
                    ? ' This is the last place, so the shift becomes filled and every offer still waiting is withdrawn.'
                    : ''}
                </>
              ) : null
            }
            reversible="You can release them afterwards from the Roster, with a reason, and they are told."
            confirmLabel="Confirm"
            loading={confirm.isPending}
            onConfirm={() => confirming && confirm.mutate(confirming.userId)}
          >
            {confirm.isError ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertDescription className="space-y-1">
                  <p className="font-medium">They were not confirmed.</p>
                  <p>{errorMessage(confirm.error)}</p>
                </AlertDescription>
              </Alert>
            ) : null}
          </ConfirmDialog>
        </>
      ) : null}
    </>
  );
}

/** One labelled fact. Wraps, never truncates: a rate or a level cut short is a wrong one. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-base [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

const NEXT_MARK = {
  find: { icon: Sparkles, title: 'Next step', variant: 'info' },
  wait: { icon: Clock, title: 'Waiting on practitioners', variant: 'info' },
  confirm: { icon: UserCheck, title: 'Needs your decision', variant: 'warning' },
  done: { icon: CircleCheck, title: 'Filled', variant: 'default' },
  closed: { icon: Info, title: 'Closed', variant: 'default' },
  started: { icon: Clock, title: 'Already started', variant: 'warning' },
} as const;

function NextStepNote({ kind, text }: { kind: keyof typeof NEXT_MARK; text: string }) {
  const mark = NEXT_MARK[kind];
  const Icon = mark.icon;
  return (
    <Alert variant={mark.variant}>
      <Icon />
      <AlertTitle>{mark.title}</AlertTitle>
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}
