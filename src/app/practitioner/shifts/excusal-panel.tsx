'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/app/status-badge';
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
 * A shift that ends with nobody checked in is flagged for an officer to
 * decide whose fault it was, and only one of the answers marks the
 * practitioner's record. The practitioner always had the right to say why —
 * the endpoint existed — but no screen to say it from, so the officer decided
 * without hearing them. Shown only once the shift has ended with no check-in,
 * because before then the right thing to do is turn up.
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
  const [reason, setReason] = useState('');

  // Joined onto the shift by the list: a shift nobody issued a code for has no
  // attendance record, which arrives as null — "not attended", the clearest
  // no-show there is, rather than something that was ever an error.
  const attendance = { isSuccess: true, data: record ?? null };

  const attended = Boolean(attendance.data?.checkedInAt);

  const excusals = useQuery({
    queryKey: ['my-excusals', assignmentId],
    queryFn: async () => {
      const body = await api.get<{ excusals?: Excusal[] }>(
        `/api/v1/assignments/${assignmentId}/excusals`,
      );
      return body.excusals ?? [];
    },
    enabled: attendance.isSuccess && !attended,
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

  if (!attendance.isSuccess || attended || !excusals.isSuccess) return null;

  const waiting = excusals.data.some((row) => row.status === 'REQUESTED');
  const granted = excusals.data.some((row) => row.status === 'GRANTED');

  return (
    <div className="space-y-3 border-t pt-4">
      <Alert variant="warning">
        <AlertDescription>
          This shift ended with no check-in recorded. Medilink will decide whether the absence was
          anybody&apos;s fault. If something stopped you attending, say so here.
        </AlertDescription>
      </Alert>

      {excusals.data.map((row) => (
        <div key={row.id} className="space-y-1.5 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">You wrote {formatAgo(row.createdAt)}</p>
            <StatusBadge status={row.status} />
          </div>
          <p className="text-sm">{row.reason}</p>
          {row.decisionNotes ? (
            <p className="text-xs text-muted-foreground">Medilink replied: {row.decisionNotes}</p>
          ) : null}
        </div>
      ))}

      {canAsk && !waiting && !granted ? (
        <div className="space-y-2">
          <Label htmlFor={`excusal-${assignmentId}`}>Why you could not attend</Label>
          <Textarea
            id={`excusal-${assignmentId}`}
            rows={3}
            placeholder="What happened, and who can confirm it."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button
            size="sm"
            disabled={reason.trim().length < MIN_REASON}
            loading={ask.isPending}
            onClick={() => ask.mutate()}
          >
            Send my explanation
          </Button>
        </div>
      ) : null}
    </div>
  );
}
