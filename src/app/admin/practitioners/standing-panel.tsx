'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleCheck, ShieldAlert, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useCan } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid } from '@/components/app/page-shell';
import { formatDate, formatWhen } from '@/components/app/format';

interface ScreeningReview {
  screening: {
    status: string;
    matchedOn: string | null;
    screenedAt: string;
    clearedBy: string | null;
    notes: string | null;
  } | null;
  matchedEntry: {
    fullName: string;
    sourceList: string;
    folioNumber: string | null;
    reason: string | null;
    listedAt: string;
  } | null;
}

interface Suspension {
  reason: string;
  suspendedAt: string;
  incidentId: string | null;
}

/** The lists by the names compliance uses for them; humanise() lowercases the acronym. */
const LIST_NAMES: Record<string, string> = {
  MDCN_QUACK_LIST: 'MDCN quack list',
  MDCN_SANCTIONS: 'MDCN sanctions list',
  INTERNAL: 'Medilink internal list',
};

/** Matches the server: a cleared flag or a lifted suspension needs a real reason. */
const MIN_CLEAR_NOTES = 20;
const MIN_REINSTATE_REASON = 20;

/**
 * The two things that stop a verified practitioner working which are not
 * about their documents: a sanctions-screening match, and a suspension.
 *
 * Both could be put on an account and neither could be taken off from a
 * screen. A flag stayed for good, so a nurse who shared a name with somebody
 * on the MDCN list was blocked with no way back; a suspension needed a
 * database edit to lift. Each answer needs a written reason, because each one
 * returns somebody to clinical work.
 */
export function StandingPanel({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const canReview = useCan('credential.review');
  const canManageIncidents = useCan('incident.manage');

  return (
    <>
      {canReview ? <ScreeningCard userId={userId} onChanged={onChanged} /> : null}
      {canManageIncidents ? <SuspensionCard userId={userId} onChanged={onChanged} /> : null}
    </>
  );
}

function ScreeningCard({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');

  const review = useQuery({
    queryKey: ['screening', userId],
    queryFn: () => api.get<ScreeningReview>(`/api/v1/practitioners/screening?userId=${userId}`),
    retry: false,
  });

  const clear = useMutation({
    mutationFn: () => api.post('/api/v1/practitioners/screening', { userId, notes: notes.trim() }),
    onSuccess: () => {
      toast.success('Flag cleared', { description: 'Recorded as a different person, with your note.' });
      setNotes('');
      void queryClient.invalidateQueries({ queryKey: ['screening', userId] });
      onChanged();
    },
    onError: (error) => toast.error('Could not clear it', { description: errorMessage(error) }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Sanctions screening</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {review.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : review.isError ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>The screening result could not be loaded.</AlertDescription>
          </Alert>
        ) : !review.data.screening ? (
          <p className="text-sm text-muted-foreground">
            Not screened yet. Screening runs when somebody signs up and every night after.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={review.data.screening.status} />
              <span className="text-xs text-muted-foreground">
                Checked {formatWhen(review.data.screening.screenedAt)} against the MDCN quack and
                sanctions lists and Medilink&apos;s own.
              </span>
            </div>

            {review.data.screening.status === 'FLAGGED' && review.data.matchedEntry ? (
              <>
                <Alert variant="warning">
                  <ShieldAlert />
                  <AlertDescription>
                    Their name matched an entry on a list. Compare the details before deciding:
                    sharing a name with somebody listed is common, and a match is not a finding.
                  </AlertDescription>
                </Alert>
                <DetailGrid>
                  <Detail label="Listed as">{review.data.matchedEntry.fullName}</Detail>
                  <Detail label="List">
                    {LIST_NAMES[review.data.matchedEntry.sourceList] ?? humanise(review.data.matchedEntry.sourceList)}
                  </Detail>
                  <Detail label="Folio number">{review.data.matchedEntry.folioNumber ?? '—'}</Detail>
                  <Detail label="Listed">{formatDate(review.data.matchedEntry.listedAt)}</Detail>
                </DetailGrid>
                {review.data.matchedEntry.reason ? (
                  <p className="text-sm text-muted-foreground">
                    Why they are listed: {review.data.matchedEntry.reason}
                  </p>
                ) : null}

                <div className="space-y-2 border-t pt-4">
                  <Label htmlFor="screening-notes">
                    Why this is a different person{' '}
                    <span className="font-normal text-muted-foreground">— required</span>
                  </Label>
                  <Textarea
                    id="screening-notes"
                    rows={3}
                    placeholder="What you compared: folio number, date of birth, the regulator's record."
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    If it is the same person, leave the flag in place. They stay unable to be
                    offered work.
                  </p>
                  <Button
                    disabled={notes.trim().length < MIN_CLEAR_NOTES}
                    loading={clear.isPending}
                    onClick={() => clear.mutate()}
                  >
                    Clear the flag
                  </Button>
                </div>
              </>
            ) : review.data.screening.status === 'CLEAR' && review.data.screening.notes ? (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                Cleared by an officer: {review.data.screening.notes}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SuspensionCard({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  const suspensions = useQuery({
    queryKey: ['suspensions', userId],
    queryFn: () =>
      api.get<{ current: Suspension | null; history: Suspension[] }>(
        `/api/v1/users/${userId}/suspensions`,
      ),
    retry: false,
  });

  const reinstate = useMutation({
    mutationFn: () => api.post(`/api/v1/users/${userId}/reinstate`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Reinstated', { description: 'They can sign in again.' });
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['suspensions', userId] });
      onChanged();
    },
    onError: (error) => toast.error('Could not reinstate them', { description: errorMessage(error) }),
  });

  if (suspensions.isPending) return <Skeleton className="h-16 w-full" />;
  if (suspensions.isError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertDescription>Their suspension record could not be loaded.</AlertDescription>
      </Alert>
    );
  }

  const { current, history } = suspensions.data;
  if (!current && history.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Suspension</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {current ? (
          <>
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertDescription>
                Suspended {formatWhen(current.suspendedAt)}. They cannot sign in. Reason:{' '}
                {current.reason}
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label htmlFor="reinstate-reason">
                Why they may return{' '}
                <span className="font-normal text-muted-foreground">— required</span>
              </Label>
              <Textarea
                id="reinstate-reason"
                rows={3}
                placeholder="The review that cleared them, and any conditions."
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button
                variant="outline"
                disabled={reason.trim().length < MIN_REINSTATE_REASON}
                loading={reinstate.isPending}
                onClick={() => reinstate.mutate()}
              >
                Reinstate
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not suspended now. Suspended {history.length} time{history.length === 1 ? '' : 's'}{' '}
            before; each is kept in the record.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
