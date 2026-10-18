'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Sparkles, TriangleAlert, UserCheck, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { useScopeIds, useSession } from '@/lib/ui/session';
import { useShiftEstimate } from '@/lib/ui/estimate';
import { nameOf, useReference } from '@/lib/ui/reference';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader } from '@/components/app/page-shell';
import { formatNaira, formatWhen } from '@/components/app/format';
import { ShiftEstimate } from '@/components/app/shift-estimate';
import { EXCLUSION_WORDS } from '@/modules/matching/domain/matching-rules';
import type { ExclusionReason } from '@/modules/matching/domain/engine';

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

/**
 * One shift: rank, offer, confirm.
 *
 * **The ranking explains itself.** Every candidate carries the factors that
 * produced their score, and they are shown rather than hidden behind a
 * number — step 9.4 requires every match to be reviewed by hand for the first
 * fifty engagements, and a reviewer given only "82" has nothing to review.
 *
 * **Nothing invites automatically.** The engine ranks; a person chooses.
 */
export default function ShiftDetailPage() {
  const params = useParams<{ id: string }>();
  const requestId = params.id;
  const facilityId = useFacilityId();
  const reference = useReference();
  const queryClient = useQueryClient();

  // Matching, offering and confirming are all guarded on assignment.confirm.
  // This page is reached on service_request.read, which an administrator and
  // an accounts officer hold without it, so the controls are hidden rather
  // than left to answer 403 — the same rule the dashboard already follows.
  const canStaff = useSession().permissions.includes('assignment.confirm');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const shift = useQuery({
    queryKey: ['shift', requestId],
    queryFn: () =>
      api.get<ServiceRequest>(
        `/api/v1/service-requests/${requestId}?facilityId=${facilityId}`,
      ),
    enabled: Boolean(facilityId),
  });

  // What it comes to, before anybody is offered or confirmed onto it (M11-04). The preview is
  // guarded on publishing for the facility, which an administrator of the platform does not hold.
  const canEstimate = useScopeIds('service_request.publish', 'FACILITY').includes(facilityId ?? '');
  const estimate = useShiftEstimate({
    facilityId,
    startsAt: shift.data ? new Date(shift.data.startsAt) : null,
    endsAt: shift.data ? new Date(shift.data.endsAt) : null,
    hourlyRateKobo: shift.data?.hourlyRateKobo ?? 0,
    headcount: shift.data?.headcount ?? 1,
    allowed: canEstimate,
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
    onError: (error) => toast.error('Could not run the match', { description: errorMessage(error) }),
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
      toast.success(`Offered to ${data.length} practitioner${data.length === 1 ? '' : 's'}`);
    },
    onError: (error) => toast.error('Could not send the offer', { description: errorMessage(error) }),
  });

  const confirm = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/api/v1/service-requests/${requestId}/confirm`, { facilityId, userId }),
    onSuccess: () => {
      toast.success('Practitioner confirmed onto the shift');
      void queryClient.invalidateQueries({ queryKey: ['shift-assignments'] });
      // Filling the last place withdraws everybody else's offer.
      void queryClient.invalidateQueries({ queryKey: ['shift-invitations'] });
      void queryClient.invalidateQueries({ queryKey: ['shift', requestId] });
    },
    onError: (error) => toast.error('Could not confirm', { description: errorMessage(error) }),
  });

  const confirmed = (assignments.data?.assignments ?? []).filter(
    (row) => row.status === 'CONFIRMED' || row.status === 'COMPLETED',
  );

  function toggle(userId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  return (
    <>
      <Link
        href="/facility/shifts"
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'mb-4 -ml-2')}
      >
        <ArrowLeft />
        All shifts
      </Link>

      {shift.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : shift.isError || !shift.data ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>This shift could not be loaded.</AlertDescription>
        </Alert>
      ) : (
        <>
          <PageHeader
            title={nameOf(reference.data?.professionalCategories, shift.data.professionalCategoryId)}
            description={`${formatWhen(shift.data.startsAt)} — ${formatWhen(shift.data.endsAt)}`}
            action={<StatusBadge status={shift.data.status} />}
          />

          <Card className="mb-6">
            <CardContent className="pt-6">
              <DetailGrid>
                <Detail label="Shift type">{humanise(shift.data.shiftType)}</Detail>
                {shift.data.cadreLevelId ? (
                  <Detail label="Level">
                    {nameOf(reference.data?.cadreLevels, shift.data.cadreLevelId)}
                    {shift.data.supervisionAvailable ? ' · someone will supervise' : ''}
                  </Detail>
                ) : null}
                <Detail label="Urgency">{humanise(shift.data.urgency)}</Detail>
                <Detail label="Hourly rate">{formatNaira(shift.data.hourlyRateKobo)}</Detail>
                <Detail label="Filled">
                  <span className="tabular">
                    {confirmed.length} of {shift.data.headcount}
                  </span>
                </Detail>
              </DetailGrid>
              {estimate ? <ShiftEstimate estimate={estimate} className="mt-4" /> : null}
              {shift.data.notes ? (
                <p className="mt-4 rounded-md bg-muted px-3 py-2 text-sm">{shift.data.notes}</p>
              ) : null}
            </CardContent>
          </Card>

          {confirmed.length > 0 ? (
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Confirmed</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {confirmed.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate">{row.practitionerName}</p>
                      {row.practitionerPhone ? (
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {row.practitionerPhone}
                        </p>
                      ) : (
                        <p className="truncate text-xs text-muted-foreground">
                          Phone shown from 2 days before the shift
                        </p>
                      )}
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {invitations.length > 0 ? (
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Offered</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {invitations.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <span>{row.practitionerName}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        lapses {formatWhen(row.expiresAt)}
                      </span>
                      <StatusBadge status={row.status} />
                    </span>
                  </div>
                ))}
                <p className="pt-1 text-xs text-muted-foreground">
                  Accepting is not being confirmed — you still decide. Answers appear here as
                  they come in; confirm below.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm">Who could work this</CardTitle>
                {matchRun ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {matchRun.rankedCount} eligible of {matchRun.consideredCount} considered
                  </p>
                ) : null}
              </div>
              {canStaff ? (
                <Button
                  variant={matchRun ? 'outline' : 'default'}
                  loading={runMatch.isPending}
                  onClick={() => runMatch.mutate()}
                >
                  <Sparkles />
                  {matchRun ? 'Run again' : 'Find candidates'}
                </Button>
              ) : null}
            </CardHeader>

            <CardContent>
              {!matchRun ? (
                <EmptyState
                  icon={<UserPlus />}
                  title="No match run yet"
                  description="Ranking is a computation, not a decision — it changes nothing until you offer the shift to somebody."
                />
              ) : matchRun.ranked.length === 0 ? (
                <EmptyState
                  icon={<UserPlus />}
                  title="Nobody is eligible"
                  description="Every candidate was excluded. The reasons are listed below."
                />
              ) : (
                <div className="space-y-3">
                  {matchRun.ranked.map((candidate) => {
                    const picked = selected.has(candidate.userId);
                    return (
                      <button
                        key={candidate.userId}
                        data-testid={`candidate-${candidate.userId}`}
                        onClick={() => toggle(candidate.userId)}
                        className={cn(
                          'w-full rounded-lg border p-4 text-left transition-colors',
                          picked ? 'border-primary bg-accent' : 'hover:bg-muted/50',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                              {candidate.rank}
                            </span>
                            <div>
                              <p className="text-sm font-medium">{candidate.practitionerName}</p>
                              <p className="text-xs text-muted-foreground">
                                score <span className="tabular">{candidate.score}</span> of 100
                              </p>
                            </div>
                          </div>
                          {picked ? <Badge>Selected</Badge> : null}
                        </div>

                        {/* The factors, shown rather than summarised: a
                            reviewer given only a number has nothing to
                            review, and 9.4 requires review by hand. */}
                        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                          {candidate.factors.map((factor) => (
                            <div
                              key={factor.factor}
                              className="flex items-center gap-2 text-xs text-muted-foreground"
                            >
                              <span className="w-20 shrink-0 capitalize">{factor.factor}</span>
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-primary/60"
                                  style={{ width: `${Math.round(factor.raw * 100)}%` }}
                                />
                              </div>
                              <span className="w-28 shrink-0 truncate" title={factor.detail}>
                                {factor.detail}
                              </span>
                            </div>
                          ))}
                        </div>
                      </button>
                    );
                  })}

                  <Separator />

                  <div className="flex flex-wrap items-center gap-3">
                    {canStaff ? (
                      <Button
                        disabled={selected.size === 0}
                        loading={invite.isPending}
                        onClick={() => invite.mutate()}
                      >
                        <UserCheck />
                        Offer to {selected.size || 'the'} selected
                      </Button>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Nothing is offered until you click. The engine ranks; a person chooses.
                    </p>
                  </div>
                </div>
              )}

              {matchRun && matchRun.excluded.length > 0 ? (
                <details className="mt-6">
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    {matchRun.excluded.length} left out, and why
                  </summary>
                  {/* The reason counted, and what it means in a ward manager's words. For somebody
                      who offered part of the shift, that is the one thing here worth acting on. */}
                  <ul className="mt-3 space-y-2">
                    {Object.entries(countReasons(matchRun.excluded)).map(([reason, count]) => {
                      const words = EXCLUSION_WORDS[reason as ExclusionReason];
                      return (
                        <li key={reason} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <Badge variant="secondary">
                            {words?.label ?? humanise(reason)} · {count}
                          </Badge>
                          {words ? (
                            <span className="text-xs text-muted-foreground">{words.says}</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    People are not named here: this list explains why the pool is the size it is,
                    not who is busy or unverified.
                  </p>
                </details>
              ) : null}
            </CardContent>
          </Card>

          {invitations.some((row) => row.status === 'ACCEPTED') ? (
            <Card className="mt-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Ready to confirm</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {estimate ? <p className="pb-1 text-sm text-muted-foreground">{estimate.headline}.</p> : null}
                {invitations
                  .filter((row) => row.status === 'ACCEPTED')
                  .map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <span className="text-sm">{row.practitionerName}</span>
                      {canStaff ? (
                        <Button
                          size="sm"
                          loading={confirm.isPending && confirm.variables === row.userId}
                          onClick={() => confirm.mutate(row.userId)}
                        >
                          Confirm
                        </Button>
                      ) : null}
                    </div>
                  ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
