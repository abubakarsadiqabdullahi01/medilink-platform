'use client';

import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageSquareText } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/app/field';
import { ErrorState, LoadingStatus } from '@/components/app/states';
import { StatusBadge } from '@/components/app/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { type Attendance } from './check-in-panel';
import { formatAgo } from '@/components/app/format';

interface Excusal {
  id: string;
  reason: string;
  status: 'REQUESTED' | 'GRANTED' | 'REFUSED';
  decisionNotes: string | null;
  createdAt: string;
}

const MIN_REASON = 10;

/**
 * Explaining an absence, from the shift it was an absence from.
 *
 * A shift that ends with nobody checked in is flagged for an officer to decide whose fault it
 * was, and only one of the answers marks the practitioner's record. The practitioner always had
 * the right to say why — the endpoint existed — but no screen to say it from, so the officer
 * decided without hearing them. Shown only once the shift has ended with no check-in, because
 * before then the right thing to do is turn up.
 *
 * What was already written is fetched when the person opens this, not when the page loads: the
 * excusal list is one request per shift, and a page of ended shifts must not make one for each
 * before anybody has asked to look.
 */
export function ExcusalPanel({
  assignmentId,
  canAsk,
  attendance: record,
}: {
  assignmentId: string;
  canAsk: boolean;
  attendance?: Attendance | null;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const bodyId = useId();

  // A shift nobody issued a code for has no attendance record, which arrives as null — "not
  // attended", the clearest no-show there is, rather than something that was ever an error.
  const attended = Boolean(record?.checkedInAt);

  const excusals = useQuery({
    queryKey: ['my-excusals', assignmentId],
    queryFn: async () => {
      const body = await api.get<{ excusals?: Excusal[] }>(
        `/api/v1/assignments/${assignmentId}/excusals`,
      );
      return body.excusals ?? [];
    },
    enabled: open && !attended,
    retry: false,
  });

  const ask = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/assignments/${assignmentId}/excusals`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Sent', { description: 'An officer reads it before deciding anything.' });
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['my-excusals', assignmentId] });
    },
    onError: (error) => toast.error('Could not send it', { description: errorMessage(error) }),
  });

  if (attended) return null;

  const written = excusals.data ?? [];
  const waiting = written.some((row) => row.status === 'REQUESTED');
  const granted = written.some((row) => row.status === 'GRANTED');

  return (
    <div className="space-y-3 border-t pt-4">
      <Alert variant="warning">
        <AlertDescription>
          This shift ended with no check-in recorded. Medilink will decide whether the absence was
          anybody&apos;s fault. If something stopped you attending, say so here.
        </AlertDescription>
      </Alert>

      <Button
        variant="outline"
        className="w-full sm:w-auto"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <MessageSquareText />
        {open ? 'Hide' : canAsk ? 'Explain why you could not attend' : 'See what you wrote'}
      </Button>

      {open ? (
        <div id={bodyId} className="space-y-3">
          {excusals.isPending ? (
            <div aria-busy="true">
              <LoadingStatus label="Loading what you wrote" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : excusals.isError ? (
            <ErrorState
              error={excusals.error}
              onRetry={() => void excusals.refetch()}
              retrying={excusals.isFetching}
              compact
            />
          ) : (
            <>
              {written.map((row) => (
                <div key={row.id} className="space-y-1.5 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-muted-foreground">
                      You wrote {formatAgo(row.createdAt)}
                    </p>
                    <StatusBadge status={row.status} />
                  </div>
                  <p className="[overflow-wrap:anywhere]">{row.reason}</p>
                  {row.decisionNotes ? (
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      Medilink replied: {row.decisionNotes}
                    </p>
                  ) : null}
                </div>
              ))}

              {canAsk && !waiting && !granted ? (
                <div className="space-y-3">
                  <Field
                    label="Why you could not attend"
                    hint={
                      reason.trim().length > 0 && reason.trim().length < MIN_REASON
                        ? `What happened, and who can confirm it. ${MIN_REASON - reason.trim().length} more characters needed.`
                        : 'What happened, and who can confirm it.'
                    }
                  >
                    <Textarea
                      rows={3}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </Field>
                  <Button
                    className="w-full sm:w-auto"
                    disabled={reason.trim().length < MIN_REASON}
                    loading={ask.isPending}
                    onClick={() => ask.mutate()}
                  >
                    Send my explanation
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
